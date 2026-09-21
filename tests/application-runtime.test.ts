import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createApplicationRuntime, reconcileApplicationsOnStartup } from "@/lib/applications/application-runtime"
import { BASE, CHILD, dockerFake, fixture, IMAGE } from "./application-runtime-fixture"
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })
async function setup() {
  const f = await fixture(); roots.push(f.root); const fake = dockerFake(); const application = await f.app()
  const options = { runtimeRoot: f.runtimeRoot, applicationsRoot: f.apps, platformRoot: process.cwd(), run: fake.run,
    environment: { SystemRoot: "C:\\Windows", PATH: "untrusted-search-path", ProgramFiles: "C:\\Program Files", USERPROFILE: "C:\\Users\\bs", TEMP: f.root,
      OPENAI_API_KEY: "sentinel-provider", BETTER_AUTH_SECRET: "sentinel-auth", DATABASE_URL: "sentinel-db", NODE_OPTIONS: "sentinel-node", DOCKER_HOST: "sentinel-host", DOCKER_CONTEXT: "sentinel-context", WILLIAMOS_PROJECT_ROOT: "sentinel-platform" } }
  return { ...f, fake, application, options, runtime: createApplicationRuntime(options) }
}
describe("contained durable application runtime", () => {
  it("builds only trusted contexts from exact local images and verifies all launch isolation and sanitized CLI environment", async () => {
    const { runtime, application, fake } = await setup()
    const state = await runtime.start(application)
    expect(state).toMatchObject({ desired: "running", observed: "running", applicationId: "first-board", active: { sourceHead: application.head, manifestDigest: application.manifestDigest, imageId: IMAGE, staticImageId: CHILD } })
    const builds = fake.calls.filter(({ args }) => args[0] === "build")
    expect(builds).toHaveLength(2)
    for (const { args, options } of builds) {
      expect(args).toEqual(expect.arrayContaining(["--pull=false", "--network=none", "--quiet"]))
      expect(options.shell).toBe(false)
    }
    const create = fake.calls.find(({ args }) => args[0] === "create")!
    expect(create.args).toEqual(expect.arrayContaining(["--network", "none", "--read-only", "--user", "10000:10000", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--cpus", "0.5", "--memory", "128m", "--memory-swap", "128m", "--pids-limit", "32", "--log-driver", "json-file", "--log-opt", "max-size=1m", "max-file=1", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m", "--restart", "no"]))
    expect(create.args.at(-1)).toBe(IMAGE)
    expect(create.args).toContain("--pull=never")
    expect(create.args).not.toContain("--mount")
    expect(create.args.join(" ")).not.toContain(application.repositoryRoot)
    for (const call of fake.calls) {
      expect(call.executable).toBe("C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe")
      expect(call.options.env.DOCKER_CONFIG).toBe("D:\\HermesServices\\williamos-hermes-agent\\docker-config")
      expect(call.options.env.DOCKER_BUILDKIT).toBe("0")
      expect(JSON.stringify(call.options.env)).not.toContain("sentinel")
      expect(call.options.env.PATH).not.toBe("untrusted-search-path")
      expect(call.options.timeout).toBeGreaterThan(0); expect(call.options.maxBuffer).toBeLessThanOrEqual(2_000_000)
      expect(call.args[0]).not.toBe("pull")
    }
    const validation = fake.calls.find(({ args }) => args[0] === "run")!
    expect(validation.args).toContain("--pull=never")
    expect(validation.args.slice(-4)).toEqual(["node", "sha256:612bd343622ef393269a0cb2b2e3f042927b53d7e5aa2641855df377cbc81613", "--test", "test/application.test.mjs"])
    expect(validation.args.join(" ")).not.toContain(application.repositoryRoot)
  })
  it("persists desired state before every Docker mutation and adopts on process restart without a duplicate", async () => {
    const { runtime, application, fake, options, runtimeRoot } = await setup()
    fake.setMutate(async (args) => {
      if (["build", "run", "create", "start", "stop", "rm"].includes(args[0])) {
        const receipt = JSON.parse(await fs.readFile(path.join(runtimeRoot, "first-board", "runtime.json"), "utf8"))
        expect(receipt.desired).toBe(args[0] === "stop" ? "stopped" : "running")
      }
    })
    const first = await runtime.start(application)
    const second = await createApplicationRuntime(options).get(application)
    expect(second.active!.containerId).toBe(first.active!.containerId)
    expect(fake.calls.filter(({ args }) => args[0] === "create")).toHaveLength(1)
    await createApplicationRuntime(options).stop(application)
    expect((await createApplicationRuntime(options).get(application)).observed).toBe("stopped")
    expect(fake.calls.filter(({ args }) => args[0] === "start")).toHaveLength(1)
  })
  it("keeps build contexts minimal and proves validation uses the saved snapshot rather than the source checkout", async () => {
    const { runtime, application, fake } = await setup()
    const contexts: { recipe: string; files: string[] }[] = []
    fake.setMutate(async (args) => {
      if (args[0] === "build") contexts.push({ recipe: await fs.readFile(path.join(args.at(-1)!, "Dockerfile"), "utf8"), files: (await fs.readdir(args.at(-1)!)).sort() })
      if (args[0] === "run") {
        const mount = args[args.indexOf("--mount") + 1]
        const snapshot = mount.slice("type=bind,src=".length).split(",dst=")[0]
        expect(snapshot).not.toBe(application.repositoryRoot)
        expect(await fs.readFile(path.join(snapshot, "src/app.js"), "utf8")).toContain("task-form")
        expect(await fs.readdir(snapshot)).toEqual(["src", "test"])
      }
    })
    await runtime.start(application)
    expect(contexts[0].files).toEqual(["Dockerfile", "read-preview.mjs", "server.mjs"])
    expect(contexts[0].recipe).toContain(`FROM ${BASE}\n`)
    expect(contexts[1].files).toEqual(["Dockerfile", "artifact.html"])
    expect(contexts[1].recipe).toBe(`FROM ${CHILD}\nCOPY --chown=10000:10000 artifact.html /opt/williamos/artifact.html\n`)
  })
  it("reconciles each valid catalog application at most once during enabled startup", async () => {
    const { runtime, application, app, options, fake } = await setup()
    const second = await app("second-board"); await runtime.start(application); await runtime.start(second)
    fake.calls.length = 0
    const results = await reconcileApplicationsOnStartup(options)
    expect(results.map((item) => item.applicationId)).toEqual(["first-board", "second-board"])
    expect(results.map((item) => item.observed)).toEqual(["running", "running"])
    expect(fake.calls.filter(({ args }) => args[0] === "exec" && args.at(-1) === "health")).toHaveLength(2)
    expect(fake.calls.some(({ args }) => args[0] === "create" || args[0] === "build")).toBe(false)
  })
  it("bounds startup readiness even if catalog discovery stalls", async () => {
    const { options, fake } = await setup()
    await expect(reconcileApplicationsOnStartup({ ...options, deadline: Date.now() + 30 }, () => new Promise(() => {}))).rejects.toThrow("APPLICATION_STARTUP_TIMEOUT")
    expect(fake.calls).toHaveLength(0)
  })
  it("persists stopped intent across a crash before Docker stop", async () => {
    const { runtime, application, options, fake } = await setup(); await runtime.start(application)
    const crashy = createApplicationRuntime({ ...options, fault: (event) => { if (event === "after-stopped-desired") throw new Error("SIMULATED_CRASH") } })
    await expect(crashy.stop(application)).rejects.toThrow("SIMULATED_CRASH")
    expect((await createApplicationRuntime(options).get(application)).observed).toBe("stopped")
    expect([...fake.containers.values()][0].State.Running).toBe(false)
    expect(fake.calls.filter(({ args }) => args[0] === "create")).toHaveLength(1)
  })
  it("retains Stop intent when a stored policy mismatch prevents safe Docker control", async () => {
    const { runtime, application, fake, runtimeRoot } = await setup(); await runtime.start(application)
    const file = path.join(runtimeRoot, "first-board/runtime.json"), record = JSON.parse(await fs.readFile(file, "utf8"))
    record.policyDigest = "f".repeat(64); await fs.writeFile(file, JSON.stringify(record))
    fake.calls.length = 0
    await expect(runtime.stop(application)).rejects.toThrow("APPLICATION_RUNTIME_POLICY_MISMATCH")
    expect(JSON.parse(await fs.readFile(file, "utf8")).desired).toBe("stopped")
    expect((await runtime.get(application)).observed).toBe("mismatch")
    expect(fake.calls).toHaveLength(0)
  })
  it("replaces a changed generation without leaving duplicate containers", async () => {
    const { runtime, application, fake, options } = await setup()
    const old = await runtime.start(application)
    await fs.appendFile(path.join(application.repositoryRoot, "src/app.js"), "\n// second generation")
    const changed = await runtime.start(application)
    expect(changed.active!.generation).not.toBe(old.active!.generation)
    expect(changed.active!.containerId).not.toBe(old.active!.containerId)
    expect(fake.containers.size).toBe(1)
    expect((await createApplicationRuntime(options).get(application)).active!.generation).toBe(changed.active!.generation)
  })
  it("refuses runtime policy drift from the packaged asset root before Docker", async () => {
    const { application, fake, options, root } = await setup(); const assets = path.join(root, "assets")
    await fs.mkdir(path.join(assets, "config/application-runtime"), { recursive: true })
    for (const relative of ["config/execution-fabric/hermes-free-dev-agent-v2.policy.json", "scripts/application-runtime/Dockerfile", "scripts/application-runtime/server.mjs", "scripts/application-runtime/read-preview.mjs"]) {
      await fs.mkdir(path.dirname(path.join(assets, relative)), { recursive: true }); await fs.copyFile(relative, path.join(assets, relative))
    }
    const policy = JSON.parse(await fs.readFile("config/application-runtime/static-web-v1.policy.json", "utf8")); policy.memory = "4g"
    await fs.writeFile(path.join(assets, "config/application-runtime/static-web-v1.policy.json"), JSON.stringify(policy))
    await expect(createApplicationRuntime({ ...options, assetRoot: assets }).start(application)).rejects.toThrow("APPLICATION_RUNTIME_POLICY_MISMATCH")
    expect(fake.calls).toHaveLength(0)
  })
  it.each(["after-desired", "after-create", "after-start"])("recovers the %s crash point without duplicate containers", async (point) => {
    const { application, options, fake } = await setup(); let fired = false
    const crashy = createApplicationRuntime({ ...options, fault: (event) => { if (event === point && !fired) { fired = true; throw new Error("SIMULATED_CRASH") } } })
    await expect(crashy.start(application)).rejects.toThrow("SIMULATED_CRASH")
    const state = await createApplicationRuntime(options).get(application)
    expect(state.observed).toBe("running")
    expect(fake.calls.filter(({ args }) => args[0] === "create")).toHaveLength(1)
  })
  it("restarts a matching stopped desired-running container and isolates two applications", async () => {
    const { runtime, application, fake, app, options } = await setup()
    await runtime.start(application); const first = [...fake.containers.values()][0]; first.State = { ...first.State, Running: false, Status: "exited" }
    expect((await createApplicationRuntime(options).get(application)).observed).toBe("running")
    const second = await app("second-board"); await runtime.start(second); await runtime.stop(application)
    expect((await runtime.get(second)).observed).toBe("running")
    expect(fake.containers.size).toBe(2)
    expect(new Set([...fake.containers.values()].map((item) => item.Name)).size).toBe(2)
  })
  it("refuses base identity and child metadata drift before creating anything", async () => {
    const { runtime, application, fake } = await setup()
    fake.images.get(BASE).Id = `sha256:${"f".repeat(64)}`
    await expect(runtime.start(application)).rejects.toThrow("APPLICATION_RUNTIME_POLICY_MISMATCH")
    expect(fake.calls.some(({ args }) => args[0] === "create")).toBe(false)
  })
  it.each(["Volumes", "Env", "User", "Entrypoint", "parent"])("rejects child/artifact %s drift", async (field) => {
    const { runtime, application, fake } = await setup()
    fake.setMutate((args) => {
      if (args[0] === "image" && args[1] === "inspect" && args.at(-1) === IMAGE && fake.images.has(IMAGE)) {
        const image = fake.images.get(IMAGE)
        if (field === "parent") image.Parent = BASE
        else image.Config[field] = field === "Volumes" ? { "/secret": {} } : field === "Env" ? ["SECRET=leak"] : field === "User" ? "root" : ["/bin/sh"]
      }
    })
    await expect(runtime.start(application)).rejects.toThrow("APPLICATION_RUNTIME_POLICY_MISMATCH")
    expect(fake.calls.some(({ args }) => args[0] === "start")).toBe(false)
  })
  it.each(["NetworkMode", "ReadonlyRootfs", "MemorySwap", "Privileged", "SecurityOpt", "LogConfig", "Mounts", "Labels"])("fails closed on created-container %s drift before start", async (field) => {
    const { runtime, application, fake } = await setup()
    fake.setMutate((args) => {
      if (args[0] === "container" && args[1] === "inspect" && fake.containers.size) {
        const container = [...fake.containers.values()][0]
        if (field === "Mounts") container.Mounts = [{ Source: "host", Destination: "/leak" }]
        else if (field === "Labels") container.Config.Labels = { foreign: "true" }
        else container.HostConfig[field] = field === "Privileged" ? true : field === "ReadonlyRootfs" ? false : field === "MemorySwap" ? -1 : field === "NetworkMode" ? "host" : null
      }
    })
    await expect(runtime.start(application)).rejects.toThrow("APPLICATION_RUNTIME_POLICY_MISMATCH")
    expect(fake.calls.some(({ args }) => args[0] === "start" || args[0] === "rm")).toBe(false)
  })
  it("never adopts or deletes foreign deterministic-name collisions", async () => {
    const { runtime, application, fake } = await setup()
    await runtime.start(application); const container = [...fake.containers.values()][0]; container.Config.Labels = { owner: "foreign" }
    const mutations = fake.calls.filter(({ args }) => ["start", "stop", "rm", "create"].includes(args[0])).length
    expect((await runtime.get(application)).observed).toBe("mismatch")
    await expect(runtime.stop(application)).rejects.toThrow("APPLICATION_RUNTIME_POLICY_MISMATCH")
    expect(fake.calls.filter(({ args }) => ["start", "stop", "rm", "create"].includes(args[0]))).toHaveLength(mutations)
  })
  it("refuses incomplete container inspection rather than assuming omitted security defaults", async () => {
    const { runtime, application, fake } = await setup()
    fake.setMutate((args) => {
      if (args[0] === "container" && fake.containers.size) delete [...fake.containers.values()][0].HostConfig.Privileged
    })
    await expect(runtime.start(application)).rejects.toThrow("APPLICATION_RUNTIME_POLICY_MISMATCH")
    expect(fake.calls.some(({ args }) => args[0] === "start")).toBe(false)
  })
  it("accepts Docker's serialized no-mount/no-sysctl shape with omitempty fields absent", async () => {
    const { runtime, application, fake } = await setup()
    fake.setMutate((args) => {
      if (args[0] === "container" && fake.containers.size) {
        const host = [...fake.containers.values()][0].HostConfig
        delete host.Mounts; delete host.Sysctls
      }
    })
    expect((await runtime.start(application)).observed).toBe("running")
    expect(Object.hasOwn([...fake.containers.values()][0].HostConfig, "Mounts")).toBe(false)
    expect(Object.hasOwn([...fake.containers.values()][0].HostConfig, "Sysctls")).toBe(false)
  })
  it.each(["Mounts", "Sysctls"])("rejects nonempty optional HostConfig.%s", async (field) => {
    const { runtime, application, fake } = await setup()
    fake.setMutate((args) => {
      if (args[0] === "container" && fake.containers.size) [...fake.containers.values()][0].HostConfig[field] = field === "Mounts" ? [{ Type: "bind", Source: "C:/secret", Target: "/secret" }] : { "net.ipv4.ip_forward": "1" }
    })
    await expect(runtime.start(application)).rejects.toThrow("APPLICATION_RUNTIME_POLICY_MISMATCH")
    expect(fake.calls.some(({ args }) => args[0] === "start")).toBe(false)
  })
  it.each(["foreign-parent", "additional-layer"])("rejects static child %s before start and during adoption", async (mutation) => {
    const { runtime, application, fake } = await setup()
    const tamper = () => { const child = fake.images.get(CHILD); if (mutation === "foreign-parent") child.Parent = `sha256:${"f".repeat(64)}`; else if (!child.RootFS.Layers.includes("sha256:unreviewed")) child.RootFS.Layers.push("sha256:unreviewed") }
    fake.setMutate((args) => { if (args[0] === "image" && args.at(-1) === CHILD) tamper() })
    await expect(runtime.start(application)).rejects.toThrow("APPLICATION_RUNTIME_POLICY_MISMATCH")
    expect(fake.calls.some(({ args }) => args[0] === "start")).toBe(false)

    const other = await setup(); await other.runtime.start(other.application)
    const child = other.fake.images.get(CHILD)
    if (mutation === "foreign-parent") child.Parent = `sha256:${"f".repeat(64)}`; else child.RootFS.Layers.push("sha256:unreviewed")
    other.fake.calls.length = 0
    expect((await other.runtime.get(other.application)).observed).toBe("mismatch")
    expect(other.fake.calls.some(({ args }) => ["start", "exec", "rm"].includes(args[0]))).toBe(false)
  })
  it("does not trust a copied-label image reachable through a mutable static recipe tag", async () => {
    const { runtime, application, fake, app } = await setup(); await runtime.start(application)
    const tag = [...fake.images.keys()].find((key) => key.startsWith("williamos-static-runtime:"))!
    const foreign = { ...structuredClone(fake.images.get(CHILD)), Id: `sha256:${"f".repeat(64)}` }
    fake.images.set(foreign.Id, foreign); fake.images.set(tag, foreign)
    const next = await runtime.start(await app("second-board"))
    expect(next.active!.staticImageId).toBe(CHILD)
    const builds = fake.calls.filter(({ args }) => args[0] === "build" && args.includes(tag))
    expect(builds).toHaveLength(2)
    expect(builds.every(({ args }) => args.includes("--no-cache"))).toBe(true)
  })
  it("persists exact static build proof and refuses a malformed receipt ID before Docker sees it", async () => {
    const { runtime, application, fake, runtimeRoot } = await setup(); await runtime.start(application)
    const directory = path.join(runtimeRoot, "first-board")
    const filename = (await fs.readdir(directory)).find((name) => name.startsWith("static-") && name.endsWith(".json"))!
    const proof = JSON.parse(await fs.readFile(path.join(directory, filename), "utf8"))
    expect(proof).toMatchObject({ schemaVersion: 1, imageId: CHILD, baseImageId: BASE, policyDigest: expect.stringMatching(/^[a-f0-9]{64}$/), recipeDigest: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(proof.ancestry).toEqual([
      { imageId: CHILD, parentId: `sha256:${"b".repeat(64)}`, layers: ["sha256:base", "sha256:workdir", "sha256:helpers"] },
      { imageId: `sha256:${"b".repeat(64)}`, parentId: BASE, layers: ["sha256:base", "sha256:workdir"] },
    ])
    proof.imageId = "--help"; await fs.writeFile(path.join(directory, filename), JSON.stringify(proof))
    await fs.appendFile(path.join(application.repositoryRoot, "src/app.js"), "\n// new generation")
    // Discard the prior active record to exercise receipt reuse, independently from the
    // retiring-generation verifier which also rejects a changed receipt's identity.
    await fs.unlink(path.join(directory, "runtime.json")); fake.calls.length = 0
    await expect(runtime.start(application)).rejects.toThrow("APPLICATION_RUNTIME_POLICY_MISMATCH")
    expect(fake.calls.some(({ args }) => args.includes("--help"))).toBe(false)
  })
  it("reports unavailable rather than stopped when Docker cannot be reached", async () => {
    const { runtime, application, fake } = await setup(); await runtime.start(application)
    fake.setMutate(() => { throw new Error("connect ENOENT with secret details") })
    const state = await runtime.get(application)
    expect(state).toMatchObject({ desired: "running", observed: "unavailable", error: "APPLICATION_DOCKER_UNAVAILABLE" })
    expect(JSON.stringify(state)).not.toContain("secret details")
  })
  it("uses only fixed exec readers and stored IDs, checks health and artifact digest, and bounds results", async () => {
    const { runtime, application, fake, options } = await setup(); const state = await runtime.start(application)
    const html = await runtime.preview(application); expect(html).toContain("Your next small step.")
    for (const call of fake.calls.filter(({ args }) => args[0] === "exec")) {
      expect(call.args).toEqual(["exec", state.active!.containerId, "/usr/local/bin/node", "/opt/williamos/read-preview.mjs", expect.stringMatching(/^(health|preview)$/)])
      expect(call.options.timeout).toBeLessThanOrEqual(5000)
      expect(call.options.maxBuffer).toBeLessThanOrEqual(1_000_000)
    }
    const huge = createApplicationRuntime({ ...options, run: async (file, args, opts) => args[0] === "exec" && args.at(-1) === "preview" ? { code: 0, timedOut: false, stdout: "x".repeat(1_000_001), stderr: "" } : fake.run(file, args, opts) })
    await expect(huge.preview(application)).rejects.toThrow("APPLICATION_RUNTIME_OUTPUT_LIMIT")
    const timed = createApplicationRuntime({ ...options, run: async (file, args, opts) => args[0] === "exec" ? { code: 0, timedOut: true, stdout: "ready", stderr: "" } : fake.run(file, args, opts) })
    await expect(timed.preview(application)).rejects.toThrow("APPLICATION_DOCKER_TIMEOUT")
    fake.html.set(IMAGE, "changed artifact"); await expect(runtime.preview(application)).rejects.toThrow("APPLICATION_RUNTIME_POLICY_MISMATCH")
  })
})
