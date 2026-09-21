import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createApplication } from "@/lib/applications/application-creation"
import { readApplicationRepository } from "@/lib/applications/application-catalog"

export const BASE = "sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5"
export const CHILD = `sha256:${"c".repeat(64)}`
export const WORKDIR = `sha256:${"b".repeat(64)}`
export const IMAGE = `sha256:${"d".repeat(64)}`
export const ENV = ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "NODE_VERSION=22.22.0", "YARN_VERSION=1.22.22"]
export async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "contained-app-"))
  const apps = path.join(root, "apps")
  const options = { applicationsRoot: apps, platformRoot: process.cwd() }
  const app = async (id = "first-board") => {
    await createApplication({ id, displayName: id }, options)
    return readApplicationRepository(path.join(apps, id))
  }
  return { root, apps, app, runtimeRoot: path.join(root, "runtime"), options }
}

// This fake models Docker's observable objects, including the whole policy-sensitive inspect
// shape. It reads actual build contexts and derives labels/HTML from argv, never production helpers.
export function dockerFake() {
  const calls: { args: string[]; options: any; executable: string }[] = []
  const images = new Map<string, any>([[BASE, {
    Id: BASE, Os: "linux", Architecture: "amd64", Parent: "", RootFS: { Type: "layers", Layers: ["sha256:base"] },
    Config: { User: "", WorkingDir: "", Entrypoint: ["docker-entrypoint.sh"], Cmd: ["node"], Env: ENV, Volumes: null, Labels: null, OnBuild: null, Healthcheck: null, ExposedPorts: null },
  }]])
  images.set("sha256:612bd343622ef393269a0cb2b2e3f042927b53d7e5aa2641855df377cbc81613", { Id: "sha256:612bd343622ef393269a0cb2b2e3f042927b53d7e5aa2641855df377cbc81613" })
  const containers = new Map<string, any>()
  const html = new Map<string, string>()
  let serial = 0
  let mutate: ((args: string[]) => void | Promise<void>) | undefined
  const result = (stdout = "", code = 0, stderr = "") => ({ stdout, code, stderr, timedOut: false })
  const run = async (executable: string, args: string[], options: any) => {
    calls.push({ executable, args: [...args], options })
    await mutate?.(args)
    const flag = (name: string) => args[args.indexOf(name) + 1]
    const flags = (name: string) => args.flatMap((arg, i) => arg === name ? [args[i + 1]] : [])
    if (args[0] === "image" && args[1] === "inspect") {
      const target = args.at(-1)!
      return images.has(target) ? result(JSON.stringify([images.get(target)])) : result("", 1, `Error response from daemon: No such image: ${target}`)
    }
    if (args[0] === "build") {
      const context = args.at(-1)!
      const recipe = await fs.readFile(path.join(context, "Dockerfile"), "utf8")
      const labels = Object.fromEntries(flags("--label").map((entry) => { const split = entry.indexOf("="); return [entry.slice(0, split), entry.slice(split + 1)] }))
      const isChild = recipe.includes("server.mjs")
      const id = isChild ? CHILD : html.size === 0 ? IMAGE : `sha256:${"e".repeat(63)}${html.size}`
      const parent = isChild ? WORKDIR : /^FROM (sha256:[a-f0-9]{64})/m.exec(recipe)![1]
      if (isChild) images.set(WORKDIR, { ...structuredClone(images.get(BASE)), Id: WORKDIR, Parent: BASE,
        RootFS: { Type: "layers", Layers: [...images.get(BASE).RootFS.Layers, "sha256:workdir"] } })
      const metadata = {
        Id: id, Os: "linux", Architecture: "amd64", Parent: parent,
        RootFS: { Type: "layers", Layers: [...images.get(parent).RootFS.Layers, `sha256:${isChild ? "helpers" : "artifact"}`] },
        Config: { User: "10000:10000", WorkingDir: "/opt/williamos", Entrypoint: ["/usr/local/bin/node", "/opt/williamos/server.mjs"], Cmd: null,
          Env: [...ENV, "NODE_ENV=production"], Volumes: null, Labels: { ...(isChild ? {} : images.get(parent).Config.Labels), ...labels }, OnBuild: null, Healthcheck: null, ExposedPorts: null },
      }
      images.set(id, metadata); images.set(flag("--tag"), metadata)
      if (!isChild) html.set(id, await fs.readFile(path.join(context, "artifact.html"), "utf8"))
      return result(id + "\n")
    }
    if (args[0] === "run") return result("TAP version 13\n# pass 2\n")
    if (args[0] === "container" && args[1] === "inspect") {
      const target = args.at(-1)!
      const container = containers.get(target) ?? [...containers.values()].find((item) => item.Id === target)
      return container ? result(JSON.stringify([container])) : result("", 1, `Error response from daemon: No such container: ${target}`)
    }
    if (args[0] === "create") {
      const id = (++serial).toString(16).padStart(64, "0")
      const name = flag("--name")
      const image = args.at(-1)!
      const labels = Object.fromEntries(flags("--label").map((entry) => { const split = entry.indexOf("="); return [entry.slice(0, split), entry.slice(split + 1)] }))
      containers.set(name, {
        Id: id, Name: `/${name}`, Image: image, Path: "/usr/local/bin/node", Args: ["/opt/williamos/server.mjs"],
        Config: { ...structuredClone(images.get(image).Config), Image: image, Labels: labels, Hostname: flag("--hostname"), Tty: false, OpenStdin: false, AttachStdin: false },
        State: { Running: false, Status: "created", Paused: false, Restarting: false, Dead: false }, Mounts: [],
        NetworkSettings: { Networks: { none: {} }, Ports: {} },
        HostConfig: {
          NetworkMode: "none", ReadonlyRootfs: true, CapDrop: ["ALL"], CapAdd: null, SecurityOpt: ["no-new-privileges:true"],
          Memory: 134217728, MemorySwap: 134217728, NanoCpus: 500000000, PidsLimit: 32,
          LogConfig: { Type: "json-file", Config: { "max-size": "1m", "max-file": "1" } },
          Tmpfs: { "/tmp": "rw,noexec,nosuid,nodev,size=16m" }, RestartPolicy: { Name: "no", MaximumRetryCount: 0 },
          Binds: null, VolumesFrom: null, Privileged: false, AutoRemove: false, PublishAllPorts: false, PortBindings: {},
          Devices: [], DeviceRequests: null, DeviceCgroupRules: null, Links: null, ExtraHosts: null, Dns: [], DnsOptions: [], DnsSearch: [],
          IpcMode: "private", PidMode: "", UTSMode: "", UsernsMode: "", CgroupnsMode: "private", CgroupParent: "", GroupAdd: null,
          Runtime: "runc", Isolation: "", Init: false, Ulimits: null, ShmSize: 67108864, ConsoleSize: [0, 0], MaskedPaths: ["/proc/acpi", "/proc/asound", "/proc/interrupts", "/proc/kcore", "/proc/keys", "/proc/latency_stats", "/proc/sched_debug", "/proc/scsi", "/proc/timer_list", "/proc/timer_stats", "/sys/devices/virtual/powercap", "/sys/firmware"],
          ReadonlyPaths: ["/proc/bus", "/proc/fs", "/proc/irq", "/proc/sys", "/proc/sysrq-trigger"],
        },
      })
      return result(id + "\n")
    }
    const container = [...containers.values()].find((item) => item.Id === args[1] || item.Name === `/${args[1]}`)
    if (args[0] === "start" || args[0] === "stop") {
      if (!container) throw new Error("fake target missing")
      container.State.Running = args[0] === "start"; container.State.Status = args[0] === "start" ? "running" : "exited"
      return result(container.Id)
    }
    if (args[0] === "rm") { if (container) containers.delete(container.Name.slice(1)); return result() }
    if (args[0] === "exec") {
      const target = [...containers.values()].find((item) => item.Id === args[1])
      if (!target?.State.Running) throw new Error("fake exec unavailable")
      return result(args.at(-1) === "health" ? "ready\n" : html.get(target.Image))
    }
    throw new Error(`Unexpected fake Docker argv: ${JSON.stringify(args)}`)
  }
  return { run, calls, images, containers, html, setMutate: (value: typeof mutate) => { mutate = value } }
}
