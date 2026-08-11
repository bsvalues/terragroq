import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { canonicalizeJcs } from "../canonical-json.mjs"

const MANIFEST_PATH = "config/execution-fabric/aegis-standing-hash-provisioning-package.v1.json"
const EXPECTED_MANIFEST_SHA256 = "4a255a3aead96a15d40e4318956ec19e4357bd80746e94b6a0bc1fd35d32be65"
const SHA256 = /^[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/
const SSH_SHA256_FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/
const AUTHORIZED_KEY_OPTIONS = Object.freeze([
  "restrict",
  'from="192.168.1.154"',
  'command="/usr/local/libexec/williamos/aegis-standing-hash-ssh-entrypoint.mjs"',
  "no-agent-forwarding",
  "no-port-forwarding",
  "no-X11-forwarding",
  "no-pty",
  "no-user-rc",
])
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const AUTHORITY_KEYS = Object.freeze([
  "schemaVersion", "authorityId", "packageId", "manifestSha256", "repository",
  "trustedMainCommit", "machineIdSha256", "account", "workOrderId", "issueNumber",
  "rootMutationIds", "dedicatedTransportKeyFingerprint", "dedicatedTransportPublicKeySha256",
  "dedicatedTransportKeyGenerationEvidenceSha256", "reviewedCheckoutSourcePath",
  "issuedAt", "expiresAt", "singleUse", "consumed",
])
const OBSERVATION_SECTIONS = Object.freeze([
  "platform",
  "identity",
  "reviewedRelease",
  "rootOwnedAssets",
  "privateRoots",
  "replayJournal",
  "invocationBoundary",
  "standingExecutionBoundary",
])

const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
const canonicalDigest = (value) => digest(Buffer.from(canonicalizeJcs(value), "utf8"))
const equal = (left, right) => canonicalizeJcs(left) === canonicalizeJcs(right)
const exactKeys = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value)
  && equal(Object.keys(value).sort(), [...keys].sort())
const canonicalTimestamp = (value) => typeof value === "string"
  && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value
const lfTextDigest = (bytes) => digest(Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8"))

function blocked(reasonCode, detail, drift = []) {
  return {
    status: "BLOCKED",
    reasonCode,
    executionAuthorized: false,
    applyAuthorized: false,
    ownerAuthorityRequired: true,
    detail,
    drift,
    mutations: [],
  }
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("manifest must be an object")
  if (manifest.schemaVersion !== 1 || manifest.packageId !== "aegis-standing-hash-provisioning-issue-595-v1") throw new Error("manifest identity differs")
  if (manifest.status !== "PACKAGE_ONLY_NOT_APPLIED" || manifest.applyAuthorized !== false
    || manifest.executionAuthorized !== false || manifest.ownerAuthorityRequired !== true) throw new Error("manifest posture differs")
  if (manifest.issue?.repository !== "bsvalues/terragroq" || manifest.issue?.number !== 595
    || manifest.issue?.workOrderId !== "WO-EF-AEGIS-STANDING-001") throw new Error("issue scope differs")
  if (manifest.trustedMain?.repository !== "bsvalues/terragroq" || manifest.trustedMain?.ref !== "refs/heads/main"
    || !COMMIT.test(manifest.trustedMain?.commit ?? "") || manifest.trustedMain?.reviewed !== true) throw new Error("reviewed main binding differs")
  if (manifest.identity?.nodeId !== "aegis" || manifest.identity?.hostname !== "aegis"
    || manifest.identity?.machineIdSha256 !== "1b490fe20bf3d61dc1f14e3a6e7fe38fc7de69c14face211fdd5afd0544c9c8b"
    || manifest.identity?.account !== "williamos-fabric" || manifest.identity?.privilege !== "non-root-no-sudo"
    || manifest.identity?.rootExecutionAllowed !== false || manifest.identity?.sudoAllowed !== false) throw new Error("AEGIS identity differs")
  if (manifest.invocationBoundary?.dedicatedTransportKeyAlgorithm !== "ssh-ed25519"
    || manifest.invocationBoundary?.dedicatedTransportKeyGenerationHost !== "hermes"
    || manifest.invocationBoundary?.dedicatedTransportPrivateKeyLocalOnly !== true
    || manifest.invocationBoundary?.dedicatedTransportPrivateKeyInspectionAllowed !== false
    || manifest.invocationBoundary?.authorizedKeyRecordExactRequired !== true
    || manifest.invocationBoundary?.dedicatedTransportKeyGenerationAuthorityRequired !== true
    || manifest.hermesPrerequisiteMutations?.length !== 1
    || manifest.hermesPrerequisiteMutations[0]?.id !== "CREATE_DEDICATED_HERMES_TRANSPORT_KEY"
    || manifest.hermesPrerequisiteMutations[0]?.separateSingleUseAuthorityRequired !== true
    || manifest.hermesPrerequisiteMutations[0]?.mustPrecedeRootApply !== true
    || !equal(manifest.invocationBoundary?.authorizedKeyOptions, AUTHORIZED_KEY_OPTIONS)) throw new Error("dedicated SSH transport boundary differs")
  if (canonicalDigest(manifest) !== EXPECTED_MANIFEST_SHA256) throw new Error("manifest canonical digest differs")
  return manifest
}

export function validateStandingProvisioningManifest(manifest) {
  return validateManifest(structuredClone(manifest))
}

export function confinedPath(repoRoot, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0
    || relativePath.includes("\\") || path.posix.isAbsolute(relativePath)
    || /^[A-Za-z]:\//.test(relativePath)) {
    throw new Error("binding path must be a non-empty relative POSIX path")
  }
  const segments = relativePath.split("/")
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("binding path must be normalized without empty or dot segments")
  }
  const root = path.resolve(repoRoot)
  const candidate = path.resolve(root, ...segments)
  const relative = path.relative(root, candidate)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("binding path escapes repository")
  return candidate
}

export function inspectStandingProvisioningPackage(repoRoot) {
  try {
    const manifestPath = confinedPath(repoRoot, MANIFEST_PATH)
    const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")))
    const drift = []
    const verifiedPaths = []
    for (const binding of manifest.bindings) {
      if (!binding || typeof binding.path !== "string" || binding.textNormalization !== "LF" || !SHA256.test(binding.sha256 ?? "")) {
        drift.push(binding?.path ?? "<invalid-binding>")
        continue
      }
      let actual = null
      try { actual = lfTextDigest(fs.readFileSync(confinedPath(repoRoot, binding.path))) } catch {}
      if (actual === binding.sha256) verifiedPaths.push(binding.path)
      else drift.push(binding.path)
    }
    if (drift.length) {
      return {
        ...blocked("PACKAGE_BINDING_DRIFT", "reviewed standing release binding differs", [...new Set(drift)].sort()),
        manifestSha256: canonicalDigest(manifest),
        verifiedPaths: [],
      }
    }
    return {
      status: "PACKAGE_INTERNAL_CONSISTENCY_ONLY",
      reasonCode: "EXTERNAL_TRUST_ROOT_REQUIRED",
      executionAuthorized: false,
      applyAuthorized: false,
      ownerAuthorityRequired: true,
      manifestSha256: canonicalDigest(manifest),
      verifiedPaths,
      drift: [],
      mutations: [],
    }
  } catch (error) {
    return {
      ...blocked("PACKAGE_INVALID", String(error?.message ?? error)),
      manifestSha256: null,
      verifiedPaths: [],
    }
  }
}

function requiredSections(observed) {
  return OBSERVATION_SECTIONS.filter((name) => !observed || typeof observed[name] !== "object"
    || observed[name] === null || Array.isArray(observed[name]))
}

function existing(check, observed, expected, prefix, drift) {
  if (observed.exists !== true) {
    if (observed.exists !== false) drift.push(`${prefix}.exists`)
    return false
  }
  for (const [key, value] of Object.entries(expected)) check(`${prefix}.${key}`, observed[key], value)
  return true
}

export function buildStandingProvisioningPlan(rawManifest, observed) {
  let manifest
  try { manifest = validateManifest(structuredClone(rawManifest)) } catch (error) {
    return blocked("PACKAGE_INVALID", String(error?.message ?? error))
  }
  const missing = requiredSections(observed)
  if (missing.length) return blocked("PREFLIGHT_EVIDENCE_INCOMPLETE", `missing observation sections: ${missing.join(",")}`)

  const drift = []
  const absentMutations = new Set()
  const check = (name, actual, expected) => { if (!equal(actual, expected)) drift.push(name) }
  const absent = (condition, mutationId) => { if (condition) absentMutations.add(mutationId) }

  const expectedPlatform = { os: "linux", effectiveUid: 0, readOnlyObservation: true }
  for (const [key, value] of Object.entries(expectedPlatform)) check(`platform.${key}`, observed.platform[key], value)
  const expectedIdentity = {
    exists: true,
    nodeId: manifest.identity.nodeId,
    hostname: manifest.identity.hostname,
    machineIdSha256: manifest.identity.machineIdSha256,
    account: manifest.identity.account,
    privilege: manifest.identity.privilege,
    rootExecutionAllowed: false,
    sudoAllowed: false,
  }
  for (const [key, value] of Object.entries(expectedIdentity)) check(`identity.${key}`, observed.identity[key], value)

  const releaseExists = existing(check, observed.reviewedRelease, {
    gitCheckoutRequired: true,
    cleanCheckoutRequired: true,
    repository: manifest.trustedMain.repository,
    ref: manifest.trustedMain.ref,
    commit: manifest.trustedMain.commit,
    reviewed: true,
    releaseRoot: manifest.reviewedRelease.releaseRoot,
    releaseManifestPath: manifest.reviewedRelease.releaseManifestPath,
    manifestSchemaVersion: manifest.reviewedRelease.manifestSchemaVersion,
    exactClosure: Object.fromEntries(manifest.reviewedRelease.runtimeClosurePaths.map((closurePath) => {
      const binding = manifest.bindings.find(({ path: bindingPath }) => bindingPath === closurePath)
      return [closurePath, binding?.sha256]
    })),
  }, "reviewedRelease", drift)
  absent(!releaseExists && observed.reviewedRelease.exists === false, "INSTALL_REVIEWED_RELEASE_CLOSURE")

  const assets = Object.fromEntries(manifest.rootOwnedAssets.map((asset) => [asset.id, asset]))
  for (const [id, asset] of Object.entries(assets)) {
    const observation = observed.rootOwnedAssets[id]
    if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
      drift.push(`rootOwnedAssets.${id}`)
      continue
    }
    const present = existing(check, observation, {
      path: asset.path,
      type: asset.type,
      owner: asset.owner,
      group: asset.group,
      mode: asset.mode,
      direct: asset.direct,
      singleLink: asset.singleLink,
    }, `rootOwnedAssets.${id}`, drift)
    if (!present && observation.exists === false) {
      if (id === "bootstrap") absent(true, "INSTALL_ROOT_OWNED_BOOTSTRAP")
      else if (id === "ssh-entrypoint") absent(true, "INSTALL_ROOT_OWNED_SSH_ENTRYPOINT")
      else if (id === "replay-epoch-initializer") absent(true, "INSTALL_ROOT_OWNED_REPLAY_EPOCH_INITIALIZER")
      else if (id === "release-manifest") absent(true, "INSTALL_ROOT_OWNED_RELEASE_MANIFEST")
      else if (id === "release-root") absent(true, "INSTALL_REVIEWED_RELEASE_CLOSURE")
    }
  }

  for (const [name, root] of Object.entries(manifest.privateRoots)) {
    const observation = observed.privateRoots[name]
    if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
      drift.push(`privateRoots.${name}`)
      continue
    }
    const expected = structuredClone(root)
    const present = existing(check, observation, expected, `privateRoots.${name}`, drift)
    const mutationId = name === "request"
      ? "CREATE_PRIVATE_REQUEST_ROOT"
      : name === "ledger"
        ? "CREATE_PRIVATE_LEDGER_ROOT"
        : "CREATE_PRIVATE_NODE_LEASE_ROOT"
    absent(!present && observation.exists === false, mutationId)
  }

  const epochPresent = existing(check, observed.replayJournal, {
    provider: manifest.replayJournal.provider,
    identifier: manifest.replayJournal.identifier,
    epochId: manifest.replayJournal.epochId,
    retained: true,
    reconstructionAllowed: false,
  }, "replayJournal", drift)
  absent(!epochPresent && observed.replayJournal.exists === false, "ESTABLISH_REPLAY_JOURNAL_EPOCH")

  const invocationPresent = existing(check, observed.invocationBoundary, {
    sourceHost: manifest.invocationBoundary.sourceHost,
    sourceAddress: manifest.invocationBoundary.sourceAddress,
    targetHost: manifest.invocationBoundary.targetHost,
    targetHostEd25519Fingerprint: manifest.invocationBoundary.targetHostEd25519Fingerprint,
    account: manifest.invocationBoundary.account,
    authorizedKeysPath: manifest.invocationBoundary.authorizedKeysPath,
    forcedCommandPath: manifest.invocationBoundary.forcedCommandPath,
    dedicatedTransportKeyRequired: true,
    dedicatedTransportKeyAlgorithm: manifest.invocationBoundary.dedicatedTransportKeyAlgorithm,
    dedicatedTransportKeyGenerationHost: manifest.invocationBoundary.dedicatedTransportKeyGenerationHost,
    dedicatedTransportPrivateKeyPath: manifest.invocationBoundary.dedicatedTransportPrivateKeyPath,
    dedicatedTransportPublicKeyPath: manifest.invocationBoundary.dedicatedTransportPublicKeyPath,
    dedicatedTransportPrivateKeyLocalOnly: true,
    dedicatedTransportPrivateKeyInspectionAllowed: false,
    dedicatedTransportKeyFingerprintEvidenceRequired: true,
    existingKeyReuseAllowed: false,
    authorizedKeyOptions: manifest.invocationBoundary.authorizedKeyOptions,
    authorizedKeyRecordExactRequired: true,
    passwordAuthenticationAllowed: false,
    unrestrictedShellAllowed: false,
    executable: manifest.invocationBoundary.executable,
    bootstrapPath: manifest.invocationBoundary.bootstrapPath,
    argumentOrder: manifest.invocationBoundary.argumentOrder,
    workloadClass: "HASH_VERIFY",
    arbitraryArgumentsAllowed: false,
    arbitraryCommandAllowed: false,
    shellAllowed: false,
    ptyAllowed: false,
    forwardingAllowed: false,
    sudoAllowed: false,
  }, "invocationBoundary", drift)
  if (invocationPresent && !SSH_SHA256_FINGERPRINT.test(observed.invocationBoundary.dedicatedTransportKeyFingerprint ?? "")) {
    drift.push("invocationBoundary.dedicatedTransportKeyFingerprint")
  }
  if (!invocationPresent && observed.invocationBoundary.exists === false) {
    absent(true, "INSTALL_FORCED_COMMAND_AUTHORIZED_KEY")
  }

  const expectedExecutionBoundary = {
    exists: true,
    ...manifest.standingExecutionBoundary,
    blockedScope: manifest.blockedScope,
  }
  for (const [key, value] of Object.entries(expectedExecutionBoundary)) {
    check(`standingExecutionBoundary.${key}`, observed.standingExecutionBoundary[key], value)
  }

  if (drift.length) {
    return blocked("PROVISIONING_DRIFT", "existing standing prerequisite state differs; overwrite is refused", [...new Set(drift)].sort())
  }
  const mutations = manifest.rootMutations
    .filter(({ id }) => absentMutations.has(id))
    .map(({ id, asset }) => ({ id, asset }))
  if (mutations.length) {
    return {
      status: "DRY_RUN_REQUIRED",
      reasonCode: "ROOT_PROVISIONING_AUTHORITY_REQUIRED",
      executionAuthorized: false,
      applyAuthorized: false,
      ownerAuthorityRequired: true,
      drift: [],
      mutations,
      externalPrerequisites: manifest.hermesPrerequisiteMutations.map(({ id, asset }) => ({ id, asset })),
    }
  }
  return {
    status: "READY",
    reasonCode: "PREREQUISITES_ALREADY_MATCH",
    executionAuthorized: false,
    applyAuthorized: false,
    ownerAuthorityRequired: true,
    drift: [],
    mutations: [],
  }
}

export function validateStandingProvisioningAuthority(rawManifest, proposedAuthority, now) {
  let manifest
  try { manifest = validateManifest(structuredClone(rawManifest)) } catch (error) {
    return blocked("PACKAGE_INVALID", String(error?.message ?? error))
  }
  if (!exactKeys(proposedAuthority, AUTHORITY_KEYS)) {
    return blocked("PROVISIONING_AUTHORITY_INVALID", "proposed root authority format differs")
  }
  if (proposedAuthority.schemaVersion !== 1 || !GUID.test(proposedAuthority.authorityId ?? "")
    || proposedAuthority.singleUse !== true) {
    return blocked("PROVISIONING_AUTHORITY_INVALID", "proposed root authority format differs")
  }
  if (proposedAuthority.consumed !== false) {
    return blocked("PROVISIONING_AUTHORITY_CONSUMED", "proposed root authority was already consumed")
  }
  const expectedScope = {
    packageId: manifest.packageId,
    manifestSha256: canonicalDigest(manifest),
    repository: manifest.trustedMain.repository,
    trustedMainCommit: manifest.trustedMain.commit,
    machineIdSha256: manifest.identity.machineIdSha256,
    account: manifest.identity.account,
    workOrderId: manifest.issue.workOrderId,
    issueNumber: manifest.issue.number,
    rootMutationIds: manifest.rootMutations.map(({ id }) => id),
  }
  for (const [key, expected] of Object.entries(expectedScope)) {
    if (!equal(proposedAuthority[key], expected)) return blocked("PROVISIONING_AUTHORITY_SCOPE_MISMATCH", `proposed root authority ${key} differs`)
  }
  if (!SSH_SHA256_FINGERPRINT.test(proposedAuthority.dedicatedTransportKeyFingerprint ?? "")
    || !SHA256.test(proposedAuthority.dedicatedTransportPublicKeySha256 ?? "")
    || !SHA256.test(proposedAuthority.dedicatedTransportKeyGenerationEvidenceSha256 ?? "")
    || typeof proposedAuthority.reviewedCheckoutSourcePath !== "string"
    || !path.posix.isAbsolute(proposedAuthority.reviewedCheckoutSourcePath)
    || proposedAuthority.reviewedCheckoutSourcePath !== path.posix.resolve(proposedAuthority.reviewedCheckoutSourcePath)) {
    return blocked("PROVISIONING_AUTHORITY_SCOPE_MISMATCH", "proposed root authority dedicated transport binding differs")
  }
  const issued = Date.parse(proposedAuthority.issuedAt)
  const expires = Date.parse(proposedAuthority.expiresAt)
  const current = Date.parse(now)
  const maximumAgeSeconds = manifest.apply?.authorityMaximumAgeSeconds
  if (!Number.isFinite(maximumAgeSeconds) || maximumAgeSeconds <= 0) {
    return blocked("PACKAGE_INVALID", "manifest apply.authorityMaximumAgeSeconds is not a positive number")
  }
  const maximumAgeMs = maximumAgeSeconds * 1000
  if (!canonicalTimestamp(proposedAuthority.issuedAt) || !canonicalTimestamp(proposedAuthority.expiresAt)
    || !canonicalTimestamp(now) || ![issued, expires, current].every(Number.isFinite)
    || expires <= issued || expires - issued > maximumAgeMs
    || current < issued || current >= expires) {
    return blocked("PROVISIONING_AUTHORITY_EXPIRED", "proposed root authority is outside its bounded validity window")
  }
  return blocked("LIVE_ROOT_APPLY_AUTHORITY_REQUIRED", "this read-only package validates proposals but cannot authorize or perform root mutation")
}
