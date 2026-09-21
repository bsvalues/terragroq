import fs from "node:fs/promises"
import path from "node:path"
import { discoverApplications, rejectLinkedPath, type CatalogApplication } from "./application-catalog"
import { isApplicationId } from "./application-manifest"
import { ApplicationRuntimeStore, type RuntimeStoreOptions } from "./application-runtime-store"
import { createStaticWebArtifact, sha256, verifyStoredArtifact, MAX_ARTIFACT_BYTES, type StaticWebArtifact } from "./static-web-artifact"
import { baseImage, CONTAINER_ID, createContainerArgs, dockerEnvironment, dockerRunner, equal, IMAGE_ID, labelArgs, loadRuntimePolicy, mismatch, ownedContainer, ownedImage, stable, staticLabels, writeBuildContext, type DockerInspectRecord, type DockerRunner, type RuntimePolicy } from "./application-runtime-policy"

export type RuntimeGeneration = {
  generation: string; sourceHead: string; manifestDigest: string; sourceDigest: string; artifactSha256: string
  imageId: string | null; staticImageId: string | null; containerId: string | null; validated: boolean
}
export type ApplicationRuntimeRecord = {
  schemaVersion: 1; applicationId: string; desired: "running" | "stopped"; observed: "starting" | "running" | "stopped" | "unavailable" | "mismatch" | "failed"
  policyDigest: string; recipeDigest: string; containerName: string; active: RuntimeGeneration | null; retiring: RuntimeGeneration | null
  updatedAt: string; error: string | null
}
export type ApplicationRuntimeOptions = RuntimeStoreOptions & Readonly<{
  run?: DockerRunner; environment?: Record<string, string | undefined>; fault?: (event: string) => void
  deadline?: number
}>
const code = (error: unknown) => error instanceof Error && /^APPLICATION_[A-Z_]{1,80}$/.test(error.message) ? error.message : "APPLICATION_DOCKER_UNAVAILABLE"
const nameFor = (id: string) => `williamos-application-${id}`
type StaticImageProof = { schemaVersion: 1; imageId: string; baseImageId: string; policyDigest: string; recipeDigest: string
  ancestry: { imageId: string; parentId: string; layers: string[] }[] }

export function createApplicationRuntime(options: ApplicationRuntimeOptions = {}) {
  const store = new ApplicationRuntimeStore(options), run = options.run ?? dockerRunner
  // Assets belong to the deployed artifact, independently from the editable workspace identity.
  const assetRoot = path.resolve(options.assetRoot ?? process.env.WILLIAMOS_APPLICATION_ASSET_ROOT ?? process.cwd())
  let policy: RuntimePolicy
  async function command(args: string[], timeout = 15000, maxBuffer = 128000, missing?: "image" | "container") {
    if (options.deadline && Date.now() >= options.deadline) throw new Error("APPLICATION_DOCKER_TIMEOUT")
    const boundedTimeout = options.deadline ? Math.max(1, Math.min(timeout, options.deadline - Date.now())) : timeout
    let result
    try { result = await run(policy.dockerExecutable, args, { env: dockerEnvironment(options.environment ?? process.env, policy.dockerConfig), timeout: boundedTimeout, maxBuffer, encoding: "utf8", shell: false, windowsHide: true }) }
    catch { throw new Error("APPLICATION_DOCKER_UNAVAILABLE") }
    if (result.timedOut) throw new Error("APPLICATION_DOCKER_TIMEOUT")
    if (typeof result.stdout !== "string" || typeof result.stderr !== "string" || Buffer.byteLength(result.stdout) > maxBuffer || Buffer.byteLength(result.stderr) > maxBuffer) throw new Error("APPLICATION_RUNTIME_OUTPUT_LIMIT")
    if (result.code !== 0) {
      if (missing && result.code === 1 && result.stderr.trim() === `Error response from daemon: No such ${missing}: ${args.at(-1)}`) return null
      throw new Error("APPLICATION_DOCKER_UNAVAILABLE")
    }
    return result.stdout
  }
  async function inspect(kind: "image" | "container", target: string): Promise<DockerInspectRecord>
  async function inspect(kind: "image" | "container", target: string, optional: true): Promise<DockerInspectRecord | null>
  async function inspect(kind: "image" | "container", target: string, optional = false): Promise<DockerInspectRecord | null> {
    const text = await command([kind, "inspect", target], 15000, 128000, optional ? kind : undefined)
    if (text === null) return null
    try {
      const value: unknown = JSON.parse(text)
      if (!Array.isArray(value) || value.length !== 1) return mismatch()
      const inspected: unknown = value[0]
      if (!inspected || typeof inspected !== "object" || Array.isArray(inspected)) return mismatch()
      return inspected as DockerInspectRecord
    }
    catch { return mismatch() }
  }
  async function save(record: ApplicationRuntimeRecord) {
    record.updatedAt = new Date().toISOString()
    await store.writeJson(record.applicationId, "runtime.json", record)
  }
  function labels(record: ApplicationRuntimeRecord, generation: RuntimeGeneration) {
    return { ...staticLabels(policy), "io.williamos.runtime.application": record.applicationId,
      "io.williamos.runtime.generation": generation.generation, "io.williamos.runtime.artifact": generation.artifactSha256,
      "io.williamos.runtime.parent": generation.staticImageId! }
  }
  async function context<T>(id: string, work: (directory: string) => Promise<T>): Promise<T> {
    const parent = await store.directory(id), directory = await fs.mkdtemp(path.join(parent, ".context-"))
    try { return await work(directory) }
    finally { await rejectLinkedPath(directory); await fs.rm(directory, { recursive: true, force: true }) }
  }
  const proofName = () => `static-${policy.recipeDigest}.json`
  async function inspectStaticImage(id: string, base: DockerInspectRecord, env: string[]) {
    if (typeof id !== "string" || !IMAGE_ID.test(id)) return mismatch()
    const child = await inspect("image", id, true)
    if (!child) return mismatch()
    // The reviewed legacy-builder recipe creates exactly WORKDIR and COPY filesystem
    // layers. ENV/USER/ENTRYPOINT/CMD/labels may add metadata-only parent images.
    ownedImage(child, id, env, staticLabels(policy), base.RootFS.Layers, 2)
    const ancestry: StaticImageProof["ancestry"] = []
    const visited = new Set<string>()
    let current = child
    for (let count = 0; current.Id !== base.Id; count++) {
      if (count >= 16 || visited.has(current.Id) || !IMAGE_ID.test(current.Parent ?? "")) mismatch()
      visited.add(current.Id)
      ancestry.push({ imageId: current.Id, parentId: current.Parent, layers: current.RootFS.Layers })
      const parent = current.Parent === base.Id ? base : await inspect("image", current.Parent, true)
      if (!parent) return mismatch()
      if (parent.Id !== current.Parent || parent.Os !== "linux" || parent.Architecture !== "amd64"
        || parent.RootFS?.Type !== "layers" || !Array.isArray(parent.RootFS.Layers)
        || parent.RootFS.Layers.length < base.RootFS.Layers.length
        || parent.RootFS.Layers.length > current.RootFS.Layers.length
        || current.RootFS.Layers.length - parent.RootFS.Layers.length > 1
        || !equal(current.RootFS.Layers.slice(0, parent.RootFS.Layers.length), parent.RootFS.Layers)) mismatch()
      current = parent
    }
    return { child, proof: { schemaVersion: 1, imageId: id, baseImageId: base.Id, policyDigest: policy.digest, recipeDigest: policy.recipeDigest, ancestry } satisfies StaticImageProof }
  }
  async function verifiedStaticImage(applicationId: string, id: string, base: DockerInspectRecord, env: string[]) {
    const receipt = await store.readJson<StaticImageProof>(applicationId, proofName())
    if (!receipt || receipt.imageId !== id) return mismatch()
    const verified = await inspectStaticImage(id, base, env)
    if (!equal(receipt, verified.proof)) mismatch()
    return verified.child
  }
  async function verifyImages(record: ApplicationRuntimeRecord, generation: RuntimeGeneration) {
    const base = await inspect("image", policy.baseImageId), env = baseImage(base, policy)
    if (!generation.staticImageId || !generation.imageId) return mismatch()
    const child = await verifiedStaticImage(record.applicationId, generation.staticImageId, base, env)
    const artifact = await inspect("image", generation.imageId)
    ownedImage(artifact, generation.imageId, env, labels(record, generation), child.RootFS.Layers, 1)
    // Legacy builder may add metadata-only intermediate images for --label. Prove the parent
    // chain reaches the exact verified static child and carries only the single artifact layer.
    let parent = artifact.Parent; const visited = new Set<string>()
    for (let count = 0; parent !== child.Id; count++) {
      if (!IMAGE_ID.test(parent ?? "") || count >= 8 || visited.has(parent)) mismatch()
      visited.add(parent)
      const intermediate = await inspect("image", parent)
      if (!equal(intermediate.RootFS?.Layers, artifact.RootFS.Layers)
        && !equal(intermediate.RootFS?.Layers, child.RootFS.Layers)) mismatch()
      parent = intermediate.Parent
    }
    return [...env, "NODE_ENV=production"]
  }
  async function validate(record: ApplicationRuntimeRecord, artifact: StaticWebArtifact) {
    const validator = await inspect("image", policy.validatorImageId)
    if (validator.Id !== policy.validatorImageId) mismatch()
    const validatorName = `${record.containerName}-validator`
    const validatorLabels = { "io.williamos.validator.owner": "static-web-v1", "io.williamos.validator.application": record.applicationId,
      "io.williamos.validator.generation": record.active!.generation }
    const cleanup = async () => {
      const object = await inspect("container", validatorName, true)
      if (!object) return
      if (!CONTAINER_ID.test(object.Id) || object.Name !== `/${validatorName}` || object.Image !== policy.validatorImageId || !equal(object.Config?.Labels, validatorLabels)) mismatch()
      await command(["rm", "-f", object.Id])
    }
    await cleanup()
    await context(record.applicationId, async (directory) => {
      for (const [relative, contents] of Object.entries(artifact.files)) {
        const target = path.join(directory, relative); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, contents, { flag: "wx" })
      }
      try {
        await command(["run", "--pull=never", "--rm", "--name", validatorName, ...labelArgs(validatorLabels), "--network", "none", "--read-only", "--cap-drop", "ALL",
          "--security-opt", "no-new-privileges:true", "--cpus", "1", "--memory", "512m", "--memory-swap", "512m", "--pids-limit", "64", "--user", "10000:10000",
          "--mount", `type=bind,src=${directory},dst=/workspace,readonly`, "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m", "--workdir", "/workspace",
          "--entrypoint", "node", policy.validatorImageId, "--test", "test/application.test.mjs"], 60000, 2_000_000)
      } finally { await cleanup() }
    })
    record.active!.validated = true; await save(record)
  }
  async function buildImages(record: ApplicationRuntimeRecord, artifact: StaticWebArtifact) {
    const generation = record.active!
    const base = await inspect("image", policy.baseImageId), env = baseImage(base, policy)
    const childTag = `williamos-static-runtime:${policy.recipeDigest}`
    const receipt = await store.readJson<StaticImageProof>(record.applicationId, proofName())
    let child: DockerInspectRecord
    if (receipt) child = await verifiedStaticImage(record.applicationId, receipt.imageId, base, env)
    else {
      const id = await context(record.applicationId, async (directory) => {
        await writeBuildContext(directory, { ...policy.helpers, Dockerfile: policy.helpers.Dockerfile.replace("__BASE_IMAGE_ID__", policy.baseImageId) })
        return (await command(["build", "--no-cache", "--pull=false", "--network=none", "--quiet", "--tag", childTag, ...labelArgs(staticLabels(policy)), directory], 60000))!.trim()
      })
      if (!IMAGE_ID.test(id)) mismatch()
      const verified = await inspectStaticImage(id, base, env)
      // Only a fresh owned build creates a receipt. Mutable tags are never identity proof.
      await store.writeJson(record.applicationId, proofName(), verified.proof)
      child = verified.child
    }
    generation.staticImageId = child.Id
    const tag = `williamos-application:${generation.generation}`
    const id = await context(record.applicationId, async (directory) => {
      await writeBuildContext(directory, { Dockerfile: `FROM ${child.Id}\nCOPY --chown=10000:10000 artifact.html /opt/williamos/artifact.html\n`, "artifact.html": artifact.html })
      return (await command(["build", "--pull=false", "--network=none", "--quiet", "--tag", tag, ...labelArgs(labels(record, generation)), directory], 60000))!.trim()
    })
    if (!IMAGE_ID.test(id)) mismatch()
    generation.imageId = id
    await verifyImages(record, generation)
    await save(record)
  }
  async function container(record: ApplicationRuntimeRecord, generation: RuntimeGeneration, env: string[]) {
    const object = await inspect("container", record.containerName, true)
    if (object) ownedContainer(object, { name: record.containerName, imageId: generation.imageId!, containerId: generation.containerId, env, labels: labels(record, generation) })
    return object
  }
  async function reconcile(record: ApplicationRuntimeRecord): Promise<ApplicationRuntimeRecord> {
    if (!record.active) return record
    if (record.retiring) {
      const env = await verifyImages(record, record.retiring), old = await container(record, record.retiring, env)
      if (old) { if (old.State.Running) await command(["stop", old.Id]); await command(["rm", old.Id]) }
      record.retiring = null; await save(record)
    }
    const generation = record.active
    if (record.desired === "stopped" && !generation.imageId) { record.observed = "stopped"; record.error = null; await save(record); return record }
    if (!generation.validated || !generation.imageId) {
      const artifact = verifyStoredArtifact((await store.readJson<StaticWebArtifact>(record.applicationId, `${generation.generation}.json`))!)
      if (artifact.artifactSha256 !== generation.artifactSha256 || artifact.sourceHead !== generation.sourceHead || artifact.sourceDigest !== generation.sourceDigest || artifact.manifestDigest !== generation.manifestDigest) mismatch()
      if (!generation.validated) await validate(record, artifact)
      if (!generation.imageId) await buildImages(record, artifact)
    }
    const env = await verifyImages(record, generation)
    let object = await container(record, generation, env)
    if (record.desired === "stopped") {
      if (object?.State.Running) await command(["stop", object.Id])
      record.observed = "stopped"; record.error = null; await save(record); return record
    }
    if (!object) {
      // A missing previously-owned generation can be recreated from its immutable image. Reset
      // the stored ID before creation; the deterministic name still admits only one container.
      generation.containerId = null; await save(record)
      const id = (await command(createContainerArgs(record.containerName, generation.imageId!, env, labels(record, generation))))!.trim()
      if (!CONTAINER_ID.test(id)) mismatch()
      options.fault?.("after-create")
      object = await container(record, generation, env)
      if (!object) return mismatch()
      if (object.Id !== id) return mismatch()
    }
    generation.containerId = object.Id; await save(record)
    if (!object.State.Running) { await command(["start", object.Id]); options.fault?.("after-start") }
    const live = await container(record, generation, env)
    if (!live?.State.Running) throw new Error("APPLICATION_RUNTIME_NOT_RUNNING")
    const health = await command(["exec", generation.containerId!, "/usr/local/bin/node", "/opt/williamos/read-preview.mjs", "health"], 5000, 32)
    if (health !== "ready\n") throw new Error("APPLICATION_RUNTIME_HEALTH_FAILED")
    record.observed = "running"; record.error = null; await save(record)
    return record
  }
  function checkGeneration(generation: RuntimeGeneration | null) {
    if (!generation) return
    if (![generation.generation, generation.manifestDigest, generation.sourceDigest, generation.artifactSha256].every((value) => /^[a-f0-9]{64}$/.test(value))
      || !/^[a-f0-9]{40,64}$/.test(generation.sourceHead) || typeof generation.validated !== "boolean"
      || [generation.imageId, generation.staticImageId].some((value) => value !== null && !IMAGE_ID.test(value))
      || (generation.containerId !== null && !CONTAINER_ID.test(generation.containerId))) mismatch()
  }
  async function load(application: CatalogApplication) {
    if (!isApplicationId(application.manifest.id)) mismatch()
    const applicationsRoot = path.resolve(options.applicationsRoot ?? process.env.WILLIAMOS_APPLICATIONS_ROOT ?? "")
    if (path.relative(path.join(applicationsRoot, application.manifest.id), application.repositoryRoot) !== "") mismatch()
    let record = await store.readJson<ApplicationRuntimeRecord>(application.manifest.id, "runtime.json")
    if (record) {
      if (record.schemaVersion !== 1 || record.applicationId !== application.manifest.id || record.containerName !== nameFor(application.manifest.id)
        || !["running", "stopped"].includes(record.desired) || !/^[a-f0-9]{64}$/.test(record.policyDigest) || !/^[a-f0-9]{64}$/.test(record.recipeDigest)) mismatch()
      checkGeneration(record.active); checkGeneration(record.retiring)
    }
    let policyIssue: string | null = null
    try {
      policy = await loadRuntimePolicy(assetRoot)
      if (record && (record.policyDigest !== policy.digest || record.recipeDigest !== policy.recipeDigest)) mismatch()
    } catch (error) { if (!record) throw error; policyIssue = code(error) }
    if (!record) record = { schemaVersion: 1, applicationId: application.manifest.id, desired: "stopped", observed: "stopped", policyDigest: policy.digest, recipeDigest: policy.recipeDigest,
      containerName: nameFor(application.manifest.id), active: null, retiring: null, updatedAt: new Date().toISOString(), error: null }
    return { record, policyIssue }
  }
  async function action(application: CatalogApplication, operation: "start" | "stop" | "get" | "preview") {
    return store.withLock(application.manifest.id, async () => {
      const { record, policyIssue } = await load(application)
      if (policyIssue) {
        // Stop intent is durable even when changed policy prevents safe container control.
        // Repairing policy later must never restart an application the owner already stopped.
        if (operation === "stop") record.desired = "stopped"
        record.error = policyIssue; record.observed = policyIssue === "APPLICATION_RUNTIME_POLICY_MISMATCH" ? "mismatch" : "unavailable"
        await save(record)
        if (operation === "get") return record
        throw new Error(policyIssue)
      }
      if (operation === "start") {
        const artifact = await createStaticWebArtifact(application)
        const generation = sha256(stable({ applicationId: record.applicationId, sourceHead: artifact.sourceHead, sourceDigest: artifact.sourceDigest, manifestDigest: artifact.manifestDigest, artifactSha256: artifact.artifactSha256, policy: policy.digest, recipe: policy.recipeDigest }))
        if (generation !== record.active?.generation) {
          if (record.retiring) throw new Error("APPLICATION_RUNTIME_TRANSITION_PENDING")
          await store.writeJson(record.applicationId, `${generation}.json`, artifact)
          record.retiring = record.active?.imageId ? record.active : null
          record.active = { generation, sourceHead: artifact.sourceHead, manifestDigest: artifact.manifestDigest, sourceDigest: artifact.sourceDigest, artifactSha256: artifact.artifactSha256,
            imageId: null, staticImageId: null, containerId: null, validated: false }
        }
        record.desired = "running"; record.observed = "starting"; await save(record); options.fault?.("after-desired")
      } else if (operation === "stop") {
        record.desired = "stopped"; await save(record); options.fault?.("after-stopped-desired")
      }
      try {
        await reconcile(record)
        if (operation === "preview") {
          if (record.observed !== "running" || !record.active?.containerId) throw new Error("APPLICATION_RUNTIME_NOT_RUNNING")
          const html = (await command(["exec", record.active.containerId, "/usr/local/bin/node", "/opt/williamos/read-preview.mjs", "preview"], 5000, MAX_ARTIFACT_BYTES))!
          if (sha256(html) !== record.active.artifactSha256) mismatch()
          return html
        }
        return record
      } catch (error) {
        if (error instanceof Error && error.message === "SIMULATED_CRASH") throw error
        record.error = code(error)
        record.observed = record.error === "APPLICATION_RUNTIME_POLICY_MISMATCH" ? "mismatch" : ["APPLICATION_DOCKER_UNAVAILABLE", "APPLICATION_DOCKER_TIMEOUT"].includes(record.error) ? "unavailable" : "failed"
        await save(record)
        if (operation === "get") return record
        throw new Error(record.error)
      }
    })
  }
  return {
    start: (application: CatalogApplication) => action(application, "start") as Promise<ApplicationRuntimeRecord>,
    stop: (application: CatalogApplication) => action(application, "stop") as Promise<ApplicationRuntimeRecord>,
    get: (application: CatalogApplication) => action(application, "get") as Promise<ApplicationRuntimeRecord>,
    preview: (application: CatalogApplication) => action(application, "preview") as Promise<string>,
  }
}
export const getApplicationRuntime = (application: CatalogApplication) => createApplicationRuntime().get(application)
export const startApplicationRuntime = (application: CatalogApplication) => createApplicationRuntime().start(application)
export const stopApplicationRuntime = (application: CatalogApplication) => createApplicationRuntime().stop(application)
export const readApplicationPreview = (application: CatalogApplication) => createApplicationRuntime().preview(application)

export async function reconcileApplicationsOnStartup(options: ApplicationRuntimeOptions = {}, catalog = discoverApplications) {
  const deadline = Math.min(options.deadline ?? Infinity, Date.now() + 30000)
  let timer: ReturnType<typeof setTimeout> | undefined
  const work = async () => {
    const applications = (await catalog(options)).applications
    const runtime = createApplicationRuntime({ ...options, deadline })
    const results: { applicationId: string; observed: string; error: string | null }[] = []
    for (const application of applications) {
      if (Date.now() >= deadline) throw new Error("APPLICATION_STARTUP_TIMEOUT")
      try { const result = await runtime.get(application); results.push({ applicationId: result.applicationId, observed: result.observed, error: result.error }) }
      catch (error) { results.push({ applicationId: application.manifest.id, observed: "unavailable", error: code(error) }) }
    }
    return results
  }
  try {
    return await Promise.race([work(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("APPLICATION_STARTUP_TIMEOUT")), Math.max(1, deadline - Date.now())) })])
  } finally { clearTimeout(timer) }
}
