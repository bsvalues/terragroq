import { createHash } from "node:crypto"

const RAW_SCHEMA = "hermes-host-raw-observation/1"
const OBSERVATION_SCHEMA = "hermes-host-observation/1"
const runtimePattern = /(?:ollama|codex|claude|agent|runtime|watch|guard|docker|wsl|node|python)/i
const monitorPattern = /(?:hermes|williamos|p40|lab[- ]?health)/i

function lower(value) {
  return String(value ?? "").trim().toLowerCase()
}

function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function hashText(value) {
  return hashBytes(Buffer.from(String(value ?? ""), "utf8"))
}

function sortBy(items, keyOf) {
  return items.sort((left, right) => keyOf(left).localeCompare(keyOf(right)))
}

function processOwner(process) {
  return lower(process.owner || process.userName || "unknown")
}

function normalizeDocker(container) {
  const publishedPorts = []
  for (const [containerPort, bindings] of Object.entries(container.NetworkSettings?.Ports ?? {})) {
    for (const binding of bindings ?? []) {
      publishedPorts.push({
        containerPort: lower(containerPort),
        hostAddress: lower(binding.HostIp),
        hostPort: Number(binding.HostPort),
      })
    }
  }
  const mounts = (container.Mounts ?? []).map((mount) => ({
    type: lower(mount.Type),
    source: lower(mount.Source),
    destination: lower(mount.Destination),
    readWrite: Boolean(mount.RW),
  }))
  return {
    name: String(container.Name ?? "").replace(/^\//, ""),
    imageReference: lower(container.Config?.Image),
    imageDigest: lower(container.Image),
    restartPolicy: lower(container.HostConfig?.RestartPolicy?.Name || "no"),
    state: lower(container.State?.Status),
    publishedPorts: sortBy(publishedPorts, (item) => `${item.containerPort}|${item.hostAddress}|${item.hostPort}`),
    mounts: sortBy(mounts, (item) => `${item.destination}|${item.source}|${item.type}`),
  }
}

export function normalizeHermesRawObservation(raw, { longLivedSeconds = 900 } = {}) {
  if (!raw || raw.schema !== RAW_SCHEMA || !raw.raw) throw new Error("HERMES_RAW_OBSERVATION_INVALID")
  if (!Number.isSafeInteger(longLivedSeconds) || longLivedSeconds < 60 || longLivedSeconds > 86400) {
    throw new Error("HERMES_PROCESS_AGE_BOUND_INVALID")
  }
  const observedMs = Date.parse(raw.observedAt)
  if (!Number.isFinite(observedMs)) throw new Error("HERMES_RAW_OBSERVED_AT_INVALID")

  const processes = raw.raw.processes ?? []
  const processById = new Map(processes.map((process) => [Number(process.processId), process]))

  const services = (raw.raw.services ?? []).map((service) => ({
    name: lower(service.name),
    displayName: String(service.displayName ?? ""),
    startMode: lower(service.startMode),
    state: lower(service.state),
    startName: lower(service.startName),
    pathNameSha256: hashText(service.pathName),
  }))

  const scheduledTasks = (raw.raw.scheduledTaskXml ?? []).map((task) => ({
    path: lower(task.path),
    xmlSha256: hashBytes(Buffer.from(String(task.xmlBase64 ?? ""), "base64")),
  }))

  const listenerRows = [...(raw.raw.tcpListeners ?? []), ...(raw.raw.udpEndpoints ?? [])]
  // Dedupe on the doctrine identity key (protocol|address|port|owner): the same socket can be
  // reported more than once (e.g. UDP mDNS), and evaluate-hermes-doctrine fails closed on duplicate
  // identity keys. Doctrine compares the socket surface, not row multiplicity.
  const seenListenerKeys = new Set()
  const listeners = []
  for (const listener of listenerRows) {
    const process = processById.get(Number(listener.owningProcess))
    const item = {
      protocol: lower(listener.protocol),
      address: lower(listener.localAddress),
      port: Number(listener.localPort),
      owner: lower(process?.executablePath || process?.name || `pid-class:${listener.owningProcess}`),
    }
    const key = `${item.protocol}|${item.address}|${item.port}|${item.owner}`
    if (seenListenerKeys.has(key)) continue
    seenListenerKeys.add(key)
    listeners.push(item)
  }

  // PowerShell wraps a single ConvertFrom-Json array as {value:[...], Count:n}; unwrap to the array.
  const dockerRaw = raw.raw.dockerInspect ?? []
  const dockerRows = (dockerRaw.length === 1 && Array.isArray(dockerRaw[0]?.value)) ? dockerRaw[0].value : dockerRaw
  const dockerResidents = dockerRows.map(normalizeDocker)

  // Dedupe on the doctrine identity key (executablePath|owner): the same resident executable can
  // run several instances under one owner (e.g. a device-plugin host), and the doctrine comparator
  // fails closed on duplicate identity keys. Doctrine tracks resident process classes, not instances.
  const seenProcessKeys = new Set()
  const longLivedProcesses = processes
    .filter((process) => {
      const createdMs = Date.parse(process.creationDate)
      if (!Number.isFinite(createdMs) || (observedMs - createdMs) / 1000 < longLivedSeconds) return false
      return runtimePattern.test(`${process.name ?? ""} ${process.executablePath ?? ""} ${process.commandLine ?? ""}`)
    })
    .map((process) => {
      const owner = processOwner(process)
      if (owner === "unknown" || !lower(process.ownerEvidenceState).startsWith("observed")) {
        throw new Error("HERMES_RUNTIME_PROCESS_OWNER_UNKNOWN")
      }
      return {
        executablePath: lower(process.executablePath || process.name),
        owner,
        commandLineSha256: hashText(process.commandLine),
      }
    })
    .filter((process) => {
      const key = `${process.executablePath}|${process.owner}`
      if (seenProcessKeys.has(key)) return false
      seenProcessKeys.add(key)
      return true
    })

  const monitoringComponents = [
    ...services
      .filter((service) => monitorPattern.test(`${service.name} ${service.displayName}`))
      .map((service) => ({ id: `service:${service.name}`, kind: "service", reference: service.name })),
    ...scheduledTasks
      .filter((task) => monitorPattern.test(task.path))
      .map((task) => ({ id: `task:${task.path}`, kind: "scheduled-task", reference: task.path })),
  ]

  return {
    schema: OBSERVATION_SCHEMA,
    observedAt: raw.observedAt,
    hostIdentitySha256: lower(raw.hostIdentitySha256),
    inventory: {
      services: sortBy(services, (item) => item.name),
      scheduledTasks: sortBy(scheduledTasks, (item) => item.path),
      listeners: sortBy(listeners, (item) => `${item.protocol}|${item.address}|${item.port}|${item.owner}`),
      dockerResidents: sortBy(dockerResidents, (item) => item.name),
      longLivedProcesses: sortBy(longLivedProcesses, (item) => `${item.executablePath}|${item.owner}|${item.commandLineSha256}`),
      monitoringComponents: sortBy(monitoringComponents, (item) => item.id),
    },
  }
}
