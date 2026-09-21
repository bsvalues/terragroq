import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
const seams = vi.hoisted(() => ({ reconcile: vi.fn() }))
vi.mock("@/lib/applications/application-runtime", () => ({ reconcileApplicationsOnStartup: seams.reconcile }))
import { register } from "@/instrumentation"
import config from "@/next.config"
import { fixture } from "./application-runtime-fixture"
import { createApplication } from "@/lib/applications/application-creation"
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
describe("application runtime startup and packaging", () => {
  it.each([undefined, "edge", "nodejs"])("does not reconcile in an unenabled %s runtime", async (runtime) => {
    vi.stubEnv("NEXT_RUNTIME", runtime); vi.stubEnv("WILLIAMOS_APPLICATION_RECONCILE_ON_START", undefined)
    vi.stubEnv("WILLIAMOS_APPLICATIONS_ROOT", "configured"); vi.stubEnv("WILLIAMOS_APPLICATION_RUNTIME_ROOT", "configured")
    await register(); expect(seams.reconcile).not.toHaveBeenCalled()
  })
  it("requires all flags, excludes build phase, and catches startup unavailability", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs"); vi.stubEnv("WILLIAMOS_APPLICATION_RECONCILE_ON_START", "1"); vi.stubEnv("WILLIAMOS_APPLICATIONS_ROOT", "configured"); vi.stubEnv("WILLIAMOS_APPLICATION_RUNTIME_ROOT", "configured")
    vi.stubEnv("NEXT_PHASE", "phase-production-build"); await register(); expect(seams.reconcile).not.toHaveBeenCalled()
    vi.stubEnv("NEXT_PHASE", undefined); seams.reconcile.mockResolvedValue([{ applicationId: "board", observed: "unavailable" }]); await register(); expect(seams.reconcile).toHaveBeenCalledTimes(1)
  })
  it("traces real policy, recipes and helpers into standalone output", async () => {
    const entries = Object.values(config.outputFileTracingIncludes ?? {}).flat().sort()
    const trustedAssets = ["config/application-runtime/static-web-v1.policy.json", "config/execution-fabric/hermes-free-dev-agent-v2.policy.json", "scripts/application-runtime/Dockerfile", "scripts/application-runtime/server.mjs", "scripts/application-runtime/read-preview.mjs", "scripts/execution-fabric/hermes-agent/invoke-hermes-free-dev-agent.ps1", "starters/static-web-v1/.williamos/application.json", "starters/static-web-v1/src/index.html", "starters/static-web-v1/src/styles.css", "starters/static-web-v1/src/app.js", "starters/static-web-v1/test/application.test.mjs"]
    expect(entries).toEqual(trustedAssets.map((relative) => `./${relative}`).sort())
    for (const relative of trustedAssets) {
      expect(entries).toContain(`./${relative}`)
      expect((await fs.stat(path.resolve(relative))).isFile()).toBe(true)
    }
  })
  it("creation uses the packaged asset root independently from the editable source root", async () => {
    const f = await fixture()
    try {
      const assets = path.join(f.root, "deployed"), editable = path.join(f.root, "editable")
      await fs.mkdir(assets); await fs.mkdir(editable)
      await fs.cp(path.resolve("starters"), path.join(assets, "starters"), { recursive: true })
      vi.stubEnv("WILLIAMOS_APPLICATION_ASSET_ROOT", assets); vi.stubEnv("WILLIAMOS_PROJECT_ROOT", editable)
      const application = await createApplication({ id: "packaged-board", displayName: "Packaged" }, f.options)
      expect(await fs.readFile(path.join(application.repositoryRoot, "src/app.js"), "utf8")).toContain("task-form")
      await expect(createApplication({ id: "unsafe-board", displayName: "Unsafe" }, { ...f.options, applicationsRoot: path.join(assets, "apps") })).rejects.toThrow("APPLICATIONS_ROOT_INVALID")
    } finally { await fs.rm(f.root, { recursive: true, force: true }) }
  })
})
