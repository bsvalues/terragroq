import { afterEach, describe, expect, it, vi } from "vitest"

import { githubRequest } from "@/scripts/runtime-operator/github.mjs"

describe("runtime operator GitHub client", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.GITHUB_REPOSITORY
    delete process.env.GITHUB_TOKEN
  })

  it("sends explicit GitHub API version, authorization, and JSON content headers", async () => {
    process.env.GITHUB_REPOSITORY = "bsvalues/terragroq"
    process.env.GITHUB_TOKEN = "test-token-not-a-secret"
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) })
    vi.stubGlobal("fetch", fetch)

    await githubRequest("/graphql", { method: "POST", body: JSON.stringify({ query: "query { viewer { login } }" }) })

    expect(fetch).toHaveBeenCalledWith("https://api.github.com/graphql", expect.objectContaining({
      headers: expect.objectContaining({
        Accept: "application/vnd.github+json",
        Authorization: "Bearer test-token-not-a-secret",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      }),
    }))
  })
})
