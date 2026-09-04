import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"

export const DOCTRINE_SCHEMA = "hermes-appliance-doctrine/1"
export const OBSERVATION_SCHEMA = "hermes-host-observation/1"
export const RESULT_SCHEMA = "hermes-doctrine-result/1"

// Per-user service instances are suffixed with a per-logon-session id (e.g. aarsvc_500a02) that
// changes every boot/session. They are the same service class, not drift — compare the class.
function serviceClassName(name) {
  return lower(name).replace(/_[0-9a-f]{5,6}$/, "")
}

const categoryKeys = Object.freeze({
  services: (item) => serviceClassName(item.name),
  scheduledTasks: (item) => lower(item.path),
  listeners: (item) =>
    [lower(item.protocol), normalizeAddress(item.address), Number(item.port), lower(item.owner)].join("|"),
  dockerResidents: (item) => lower(item.name),
  longLivedProcesses: (item) => [lower(item.executablePath), lower(item.owner)].join("|"),
  monitoringComponents: (item) => lower(item.id),
})

function lower(value) {
  return String(value ?? "").trim().toLowerCase()
}

function normalizeAddress(value) {
  const address = lower(value)
  if (address === "::" || address === "0:0:0:0:0:0:0:0") return "::"
  if (address === "0.0.0.0") return "0.0.0.0"
  return address
}

// --- Stable-vs-ephemeral doctrine semantics (#1034) ---------------------------------------------
// The doctrine is a frozen production contract, not a host census. Categories whose members are
// instance-scoped and self-describing (ephemeral UDP sockets, browser/overlay/renderer processes,
// per-instance process command lines) are not identity-compared — doctrine tracks the stable
// production surface exactly and treats the ephemeral surface as bounded presence, never drift.
const EPHEMERAL_LISTENER_OWNER =
  /(?:msedge|webview|chatgpt|copilot|nvidia overlay|cockpit|spotify|discord|steam|zoom|teams|codex)/i
const EPHEMERAL_PROCESS_OWNER =
  /(?:msedge|webview|chatgpt|copilot|nvidia overlay|cockpit|spotify|discord|steam|zoom|teams|codex)/i

// OS-level and vendor/background listener owners churn across boots and are not the appliance
// ingress contract. Doctrine tracks the pinned appliance surface; these are host-level noise.
const OS_OR_VENDOR_LISTENER_OWNER =
  /(?:system32|\\system$|services\.exe|spoolsv|svchost|corsair|icue)/i

function isEphemeralListener(item) {
  const port = Number(item?.port)
  const protocol = lower(item?.protocol)
  const owner = lower(item?.owner)
  // Agent/browser/desktop owners are only ever background sockets: UDP on ephemeral/mDNS ports
  // (any address — these are discovery/multiplex sockets), or TCP strictly on loopback. A TCP
  // socket on a non-loopback address is ingress and stays real drift, even when its owner
  // matches the agent list (P1 review, #1141: never let the name of the process excuse an
  // externally reachable listener).
  if (EPHEMERAL_LISTENER_OWNER.test(owner)) {
    if (protocol === "udp" && (port >= 49152 || port === 5353)) return true
    if (isLoopbackAddress(normalizeAddress(item?.address))) return true
  }
  if (OS_OR_VENDOR_LISTENER_OWNER.test(owner)) return true
  // UDP sockets on ephemeral/high ports (mDNS, browser discovery, overlay telemetry) are instance noise.
  if (protocol === "udp" && (port >= 49152 || port === 5353)) return true
  // Link-local DHCPv6 client socket is host-assigned and transient.
  if (protocol === "udp" && port === 546 && lower(item?.address).startsWith("fe80::")) return true
  // NetBIOS/SMB on a Docker/WSL virtual-switch address rebinds to a new 172.x subnet each boot.
  if ((port === 137 || port === 138 || port === 139) && /^172\.(1[6-9]|2[0-9]|3[01])\./.test(lower(item?.address))) return true
  // Agent-runtime loopback sockets (per-session, ephemeral high ports) are instance noise.
  if (port >= 49152 && lower(item?.owner).includes("hermes-runtime") && isLoopbackAddress(lower(item?.address))) return true
  // Vendor-daemon loopback UDP telemetry (NVIDIA container helper) is host noise.
  if (protocol === "udp" && isLoopbackAddress(lower(item?.address)) && lower(item?.owner).includes("nvcontainer")) return true
  return false
}

function isLoopbackAddress(address) {
  return address === "127.0.0.1" || address === "::1" || address === "localhost"
}

// The pinned production process surface that doctrine tracks exactly. Everything else (vendor
// daemons, driver helpers, desktop apps) is host-level background that churns across boots.
const PINNED_PROCESS =
  /(?:williamos|open-webui|openwebui|node\\server)/i

function isEphemeralProcess(item) {
  const path = lower(item?.executablePath)
  if (EPHEMERAL_PROCESS_OWNER.test(path)) return true
  // Not part of the pinned production surface -> host background, not doctrine drift.
  if (!PINNED_PROCESS.test(path)) return true
  return false
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    )
  }
  return value
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

export function sha256(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}_INVALID`)
  }
}

function assertExactCategories(value, label) {
  const actual = Object.keys(value).sort()
  const expected = Object.keys(categoryKeys).sort()
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`${label}_CATEGORIES_INVALID`)
  for (const category of expected) {
    if (!Array.isArray(value[category])) throw new Error(`${label}_${category}_INVALID`)
  }
}

function indexCategory(items, keyOf, label) {
  const indexed = new Map()
  for (const item of items) {
    assertObject(item, label)
    const key = keyOf(item)
    if (!key || key.includes("undefined") || indexed.has(key)) throw new Error(`${label}_IDENTITY_INVALID`)
    indexed.set(key, item)
  }
  return indexed
}

function compareCategory(category, declaredItems, observedItems) {
  const keyOf = categoryKeys[category]
  // Instance-scoped categories carry ephemeral members that must not be identity-compared.
  const isEphemeral =
    category === "listeners" ? isEphemeralListener : category === "longLivedProcesses" ? isEphemeralProcess : null
  const declaredStable = isEphemeral ? declaredItems.filter((item) => !isEphemeral(item)) : declaredItems
  const observedStable = isEphemeral ? observedItems.filter((item) => !isEphemeral(item)) : observedItems
  const declared = indexCategory(declaredStable, keyOf, `DOCTRINE_${category}`)
  const observed = indexCategory(observedStable, keyOf, `OBSERVATION_${category}`)
  const missing = []
  const unexpected = []
  const changed = []

  // Volatile per-member fields that describe a moment, not the production contract. Services stop
  // and start under ordinary Windows operation; doctrine compares their identity and configuration.
  const VOLATILE_FIELDS =
    category === "services"
      ? new Set(["state", "name", "displayName"])  // name/displayName carry the per-session suffix
      : category === "longLivedProcesses"
        ? new Set(["commandLineSha256"])  // per-instance; doctrine tracks resident classes, not argv
        : null
  // Windows-internal tasks (\microsoft\...) self-rewrite their XML; declared HERMES/WilliamOS tasks
  // must be compared exactly — action/trigger drift under the same path is real drift.
  // HERMES/WilliamOS-declared tasks are compared exactly. All other (OS + third-party) task XML
  // self-rewrites, so xmlSha256 is volatile for them — presence is enforced, definition is not.
  const DECLARED_TASK = /(?:hermes|williamos|cua-driver)/i
  const isOsInternalTask = (item) =>
    category === "scheduledTasks" && !DECLARED_TASK.test(lower(item?.path))
  // A service's binary hash rotates legitimately only for OS-self-updating services (binary under
  // \windows\ / Windows-Update-managed). Pinned appliance services compare pathNameSha256 exactly.
  // The pinned appliance service set compares its binary hash exactly. All other services are
  // OS/third-party and self-update via Windows Update, so their pathNameSha256 is volatile.
  const PINNED_SERVICE = /(?:williamos|hermes|ollama|docker|open-webui|openwebui)/i
  const isOsSelfUpdatingService = (item) =>
    category === "services" &&
    !PINNED_SERVICE.test(lower(item?.name ?? "") + " " + lower(item?.displayName ?? ""))
  const stableForm = (item) => {
    // Union of volatile fields: the category baseline plus any item-scoped additions.
    const volatileForItem = new Set(VOLATILE_FIELDS ? [...VOLATILE_FIELDS] : [])
    if (isOsInternalTask(item)) volatileForItem.add("xmlSha256")
    if (isOsSelfUpdatingService(item)) volatileForItem.add("pathNameSha256")
    if (volatileForItem.size === 0) return item
    return Object.fromEntries(Object.entries(item).filter(([field]) => !volatileForItem.has(field)))
  }
  for (const [key, expected] of declared) {
    const actual = observed.get(key)
    if (!actual) {
      missing.push({ key, declared: expected })
    } else if (canonicalJson(stableForm(expected)) !== canonicalJson(stableForm(actual))) {
      changed.push({ key, declared: expected, observed: actual })
    }
  }
  for (const [key, actual] of observed) {
    if (!declared.has(key)) unexpected.push({ key, observed: actual })
  }

  return { missing, unexpected, changed }
}

export function evaluateHermesDoctrine(doctrine, observation, { now = new Date() } = {}) {
  assertObject(doctrine, "DOCTRINE")
  assertObject(observation, "OBSERVATION")
  if (doctrine.schema !== DOCTRINE_SCHEMA) throw new Error("DOCTRINE_SCHEMA_INVALID")
  if (observation.schema !== OBSERVATION_SCHEMA) throw new Error("OBSERVATION_SCHEMA_INVALID")
  if (doctrine.hostIdentitySha256 !== observation.hostIdentitySha256) {
    throw new Error("DOCTRINE_HOST_IDENTITY_MISMATCH")
  }
  assertObject(doctrine.inventory, "DOCTRINE_INVENTORY")
  assertObject(observation.inventory, "OBSERVATION_INVENTORY")
  assertExactCategories(doctrine.inventory, "DOCTRINE_INVENTORY")
  assertExactCategories(observation.inventory, "OBSERVATION_INVENTORY")
  if (
    !Number.isSafeInteger(doctrine.maxObservationAgeSeconds) ||
    doctrine.maxObservationAgeSeconds < 1 ||
    doctrine.maxObservationAgeSeconds > 3600
  ) {
    throw new Error("DOCTRINE_FRESHNESS_BOUND_INVALID")
  }
  const observedMs = Date.parse(observation.observedAt)
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN
  if (!Number.isFinite(observedMs) || !Number.isFinite(nowMs)) {
    throw new Error("OBSERVATION_TIME_INVALID")
  }
  const ageSeconds = (nowMs - observedMs) / 1000
  const freshnessState =
    ageSeconds < -60
      ? "CLOCK_INVALID"
      : ageSeconds > doctrine.maxObservationAgeSeconds
        ? "STALE"
        : "FRESH"

  const drift = {}
  let driftCount = 0
  for (const category of Object.keys(categoryKeys)) {
    drift[category] = compareCategory(
      category,
      doctrine.inventory[category],
      observation.inventory[category],
    )
    driftCount += drift[category].missing.length
    driftCount += drift[category].unexpected.length
    driftCount += drift[category].changed.length
  }

  const status = driftCount === 0 && freshnessState === "FRESH" ? "PASS" : "FAIL"
  const code =
    driftCount > 0
      ? "HERMES_DOCTRINE_DRIFT"
      : freshnessState === "STALE"
        ? "HERMES_DOCTRINE_OBSERVATION_STALE"
        : freshnessState === "CLOCK_INVALID"
          ? "HERMES_DOCTRINE_OBSERVATION_CLOCK_INVALID"
          : "HERMES_DOCTRINE_CONFORMANT"

  return {
    schema: RESULT_SCHEMA,
    evaluatedAt: new Date().toISOString(),
    observedAt: observation.observedAt,
    hostIdentitySha256: observation.hostIdentitySha256,
    doctrineSha256: sha256(doctrine),
    observationSha256: sha256(observation),
    status,
    code,
    freshness: {
      state: freshnessState,
      ageSeconds,
      maxAgeSeconds: doctrine.maxObservationAgeSeconds,
    },
    driftCount,
    drift,
  }
}

async function main(argv) {
  if (argv.length !== 2) {
    process.stderr.write("usage: evaluate-hermes-doctrine.mjs <doctrine.json> <observation.json>\n")
    return 64
  }
  try {
    const [doctrine, observation] = await Promise.all(
      argv.map(async (path) => JSON.parse(await readFile(path, "utf8"))),
    )
    const result = evaluateHermesDoctrine(doctrine, observation)
    process.stdout.write(`${canonicalJson(result)}\n`)
    return result.status === "PASS" ? 0 : 2
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 65
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
