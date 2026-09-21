import fs from "node:fs/promises"
import path from "node:path"
import { execFile } from "node:child_process"
import reviewed from "../../config/application-runtime/static-web-v1.policy.json"
import { readApplicationFile } from "./application-catalog"
import { sha256 } from "./static-web-artifact"

export const IMAGE_ID = /^sha256:[a-f0-9]{64}$/
export const CONTAINER_ID = /^[a-f0-9]{64}$/
export const PATH_ENV = "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export const ENTRYPOINT = ["/usr/local/bin/node", "/opt/williamos/server.mjs"]
export const mismatch = (): never => { throw new Error("APPLICATION_RUNTIME_POLICY_MISMATCH") }
export function stable(value: unknown): string {
  if (value === undefined) return "undefined"
  if (!value || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`
}
export const equal = (a: unknown, b: unknown) => stable(a) === stable(b)
const empty = (value: unknown) => value == null || (Array.isArray(value) ? value.length === 0 : typeof value === "object" && Object.keys(value).length === 0)
export type DockerOptions = Readonly<{ env: Record<string, string | undefined>; timeout: number; maxBuffer: number; shell: false; windowsHide: true; encoding: "utf8" }>
export type DockerResult = Readonly<{ code: number; stdout: string; stderr: string; timedOut?: boolean }>
export type DockerRunner = (executable: string, args: string[], options: DockerOptions) => Promise<DockerResult>
export const dockerRunner: DockerRunner = (executable, args, options) => new Promise((resolve) => {
  // Next augments ProcessEnv with a required NODE_ENV. A Docker child intentionally does not
  // inherit that platform variable; Node itself accepts this exact reviewed environment map.
  execFile(executable, args, { ...options, env: options.env as unknown as NodeJS.ProcessEnv }, (error, stdout, stderr) => resolve({ code: error ? 1 : 0, timedOut: Boolean(error?.killed), stdout: String(stdout), stderr: String(stderr) }))
})
export function dockerEnvironment(source: Record<string, string | undefined>, dockerConfig: string): Record<string, string | undefined> {
  // The executable is absolute; plugin/search paths are platform-owned. Do not inherit PATH,
  // endpoint/context overrides, NODE_OPTIONS, auth/database/provider values, or service config.
  const env: Record<string, string | undefined> = { DOCKER_CONFIG: dockerConfig, DOCKER_BUILDKIT: "0", PATH: "C:\\Program Files\\Docker\\Docker\\resources\\bin;C:\\Windows\\System32;C:\\Windows" }
  for (const key of ["SystemRoot", "SystemDrive", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramW6432"]) {
    const value = Object.entries(source).find(([candidate]) => candidate.toUpperCase() === key.toUpperCase())?.[1]
    if (value !== undefined && !/[\0\r\n]/.test(value)) env[key] = value
  }
  return env
}
export async function loadRuntimePolicy(root: string) {
  const actual = JSON.parse(await readApplicationFile(root, "config/application-runtime/static-web-v1.policy.json", 8192))
  if (!equal(actual, reviewed)) mismatch()
  const validator = JSON.parse(await readApplicationFile(root, "config/execution-fabric/hermes-free-dev-agent-v2.policy.json", 32000))
  if (validator.build?.imageId !== reviewed.validatorImageId || validator.placement?.dockerConfig !== reviewed.dockerConfig) mismatch()
  const helpers: Record<string, string> = {}
  for (const name of ["Dockerfile", "server.mjs", "read-preview.mjs"]) helpers[name] = (await readApplicationFile(root, `scripts/application-runtime/${name}`, 64000)).replace(/\r\n/g, "\n")
  const digest = sha256(stable(reviewed)), recipeDigest = sha256(stable(helpers))
  return { ...reviewed, digest, recipeDigest, helpers }
}
export type RuntimePolicy = Awaited<ReturnType<typeof loadRuntimePolicy>>
export function baseImage(image: any, policy: RuntimePolicy): string[] {
  const env: unknown = image?.Config?.Env
  if (image?.Id !== policy.baseImageId || image?.Os !== "linux" || image?.Architecture !== "amd64" || !empty(image.Config.Volumes)
    || !empty(image.Config.OnBuild) || !empty(image.Config.Healthcheck) || !empty(image.Config.ExposedPorts)
    || !Array.isArray(env) || env.length !== 3 || !env.includes(PATH_ENV)
    || env.filter((value) => typeof value === "string" && /^NODE_VERSION=22\.\d+\.\d+$/.test(value)).length !== 1
    || env.filter((value) => typeof value === "string" && /^YARN_VERSION=1\.\d+\.\d+$/.test(value)).length !== 1
    || image.RootFS?.Type !== "layers" || !Array.isArray(image.RootFS.Layers) || !image.RootFS.Layers.length) mismatch()
  return env as string[]
}
export function ownedImage(image: any, id: string, env: string[], labels: Record<string, string>, parentLayers: string[], extraLayers?: number) {
  const config = image?.Config
  if (!IMAGE_ID.test(id) || image?.Id !== id || image?.Os !== "linux" || image?.Architecture !== "amd64" || !config
    || config.User !== "10000:10000" || config.WorkingDir !== "/opt/williamos" || !equal(config.Entrypoint, ENTRYPOINT)
    || !empty(config.Cmd) || !equal([...(config.Env ?? [])].sort(), [...env, "NODE_ENV=production"].sort())
    || !equal(config.Labels, labels) || !empty(config.Volumes) || !empty(config.OnBuild) || !empty(config.Healthcheck) || !empty(config.ExposedPorts)
    || image.RootFS?.Type !== "layers" || !Array.isArray(image.RootFS.Layers)
    || !equal(image.RootFS.Layers.slice(0, parentLayers.length), parentLayers)
    || image.RootFS.Layers.length <= parentLayers.length
    || (extraLayers !== undefined && image.RootFS.Layers.length !== parentLayers.length + extraLayers)) mismatch()
}
export function staticLabels(policy: RuntimePolicy) {
  return { "io.williamos.runtime.owner": "static-web-v1", "io.williamos.runtime.policy": policy.digest,
    "io.williamos.runtime.recipe": policy.recipeDigest, "io.williamos.runtime.base": policy.baseImageId }
}
export const labelArgs = (labels: Record<string, string>) => Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`])
export function createContainerArgs(name: string, image: string, env: string[], labels: Record<string, string>): string[] {
  return ["create", "--pull=never", "--name", name, "--hostname", "williamos-application", "--network", "none", "--read-only", "--user", "10000:10000",
    "--workdir", "/opt/williamos", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--cpus", "0.5", "--memory", "128m", "--memory-swap", "128m", "--pids-limit", "32", "--log-driver", "json-file", "--log-opt", "max-size=1m", "--log-opt", "max-file=1",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m", "--restart", "no", "--ipc", "private", "--cgroupns", "private",
    ...env.flatMap((entry) => ["--env", entry]), ...labelArgs(labels), image]
}

/** Reject every policy-bearing setting before start and on adoption. Unknown non-default
 * HostConfig fields also fail closed, so new daemon capabilities cannot silently widen access. */
export function ownedContainer(container: any, expected: { name: string; imageId: string; containerId: string | null; env: string[]; labels: Record<string, string> }) {
  const config = container?.Config, host = container?.HostConfig
  if (!CONTAINER_ID.test(container?.Id ?? "") || (expected.containerId && container.Id !== expected.containerId) || container.Name !== `/${expected.name}`
    || container.Image !== expected.imageId || config?.Image !== expected.imageId || config.User !== "10000:10000" || config.WorkingDir !== "/opt/williamos"
    || !equal(config.Entrypoint, ENTRYPOINT) || !empty(config.Cmd)
    || container.Path !== ENTRYPOINT[0] || !equal(container.Args, [ENTRYPOINT[1]])
    || !equal([...(config.Env ?? [])].sort(), expected.env.slice().sort()) || !equal(config.Labels, expected.labels)
    || config.Hostname !== "williamos-application" || config.Tty || config.OpenStdin || config.AttachStdin
    || !empty(config.Volumes) || !empty(config.Healthcheck) || !empty(config.ExposedPorts) || !Array.isArray(container.Mounts) || container.Mounts.length !== 0
    || !host || !container.State || container.State.Paused || container.State.Restarting || container.State.Dead
    || !["created", "exited", "running"].includes(container.State.Status)
    || (container.State.Running !== (container.State.Status === "running"))
    || !equal(Object.keys(container.NetworkSettings?.Networks ?? {}), ["none"]) || !empty(container.NetworkSettings?.Ports)) mismatch()
  const required: Record<string, unknown> = {
    NetworkMode: "none", ReadonlyRootfs: true, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges:true"], Memory: 134217728, MemorySwap: 134217728, NanoCpus: 500000000, PidsLimit: 32,
    LogConfig: { Type: "json-file", Config: { "max-size": "1m", "max-file": "1" } }, Tmpfs: { "/tmp": "rw,noexec,nosuid,nodev,size=16m" },
    RestartPolicy: { Name: "no", MaximumRetryCount: 0 }, IpcMode: "private", CgroupnsMode: "private", Runtime: "runc",
    Privileged: false, AutoRemove: false, PublishAllPorts: false, PidMode: "", UTSMode: "", UsernsMode: "", CgroupParent: "", ShmSize: 67108864,
  }
  for (const [key, value] of Object.entries(required)) if (!equal(host[key], value)) mismatch()
  const deny = ["CapAdd", "Binds", "Mounts", "VolumesFrom", "Devices", "DeviceRequests", "DeviceCgroupRules", "PortBindings", "Links", "ExtraHosts", "Dns", "DnsOptions", "DnsSearch", "GroupAdd", "Sysctls", "Ulimits"]
  // Docker 29 serializes these two fields with omitempty. Absence means no requested
  // mounts/sysctls; all other reviewed fields must still be explicitly observable.
  const optionalEmpty = new Set(["Mounts", "Sysctls"])
  for (const key of deny) if ((!Object.hasOwn(host, key) && !optionalEmpty.has(key)) || !empty(host[key])) mismatch()
  const defaultPaths = {
    MaskedPaths: ["/proc/acpi", "/proc/asound", "/proc/interrupts", "/proc/kcore", "/proc/keys", "/proc/latency_stats", "/proc/sched_debug", "/proc/scsi", "/proc/timer_list", "/proc/timer_stats", "/sys/devices/virtual/powercap", "/sys/firmware"],
    ReadonlyPaths: ["/proc/bus", "/proc/fs", "/proc/irq", "/proc/sys", "/proc/sysrq-trigger"],
  }
  for (const [key, requiredPaths] of Object.entries(defaultPaths)) {
    if (!Array.isArray(host[key]) || !requiredPaths.every((entry) => host[key].includes(entry))) mismatch()
  }
  // Docker's default /dev/shm is a bounded private anonymous tmpfs, not an inherited image volume.
  const allowedDefaults: Record<string, unknown[]> = { ShmSize: [undefined, 67108864], OomScoreAdj: [0], CpuShares: [0], CpuPeriod: [0], CpuQuota: [0], CpuRealtimePeriod: [0], CpuRealtimeRuntime: [0] }
  const known = new Set([...Object.keys(required), ...deny, ...Object.keys(defaultPaths)])
  for (const [key, value] of Object.entries(host)) {
    if (known.has(key)) continue
    if (key === "ConsoleSize" && equal(value, [0, 0])) continue
    if (allowedDefaults[key]?.includes(value)) continue
    if (value !== false && value !== 0 && value !== "" && !empty(value)) mismatch()
  }
}

export async function writeBuildContext(directory: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) await fs.writeFile(path.join(directory, name), content, { flag: "wx", mode: 0o600 })
}
