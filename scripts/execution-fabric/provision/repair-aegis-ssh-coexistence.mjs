#!/usr/bin/node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const MANIFEST_PATH =
  "config/execution-fabric/aegis-ssh-coexistence-repair.v1.json";
export const REVIEWED_CONFIG_ASSET =
  "scripts/execution-fabric/provision/assets/90-williamos-fabric-ssh-coexistence.conf";
export const INSTALLER_PATH =
  "scripts/execution-fabric/provision/repair-aegis-ssh-coexistence.mjs";
export const LAUNCHER_PATH =
  "scripts/execution-fabric/provision/launch-aegis-ssh-coexistence-repair.sh";
export const INSTALLED_INSTALLER_PATH =
  "/usr/local/libexec/williamos-aegis-ssh-coexistence-repair.mjs";
export const CONFIG_PATH =
  "/etc/ssh/sshd_config.d/90-williamos-fabric-remote-dev.conf";
export const HOME_KEY_PATH = "/home/williamos-fabric/.ssh/authorized_keys";
export const REMOTE_DEV_KEY_PATH = "/etc/ssh/authorized_keys/williamos-fabric";
export const AUTHORIZED_KEYS_ROOT = "/etc/ssh/authorized_keys";
export const STANDING_ROOT_KEY_PATH =
  "/etc/ssh/authorized_keys/williamos-fabric-standing-hash";
export const STANDING_ENTRYPOINT_PATH =
  "/usr/local/libexec/williamos/aegis-standing-hash-ssh-entrypoint.mjs";
export const AUTHORITY_ROOT =
  "/var/lib/williamos/fabric/ssh-coexistence-repair-authorities";
export const AUTH_PROOF_ROOT =
  "/var/lib/williamos/fabric/ssh-coexistence-repair-auth-proofs";
export const LOCK_PATH =
  "/run/lock/williamos-aegis-ssh-coexistence-repair.lock";
export const KERNEL_LOCK_PATH =
  "/run/lock/williamos-aegis-ssh-coexistence-repair.kernel.lock";
export const RESERVATION_LOCK_PATHS = Object.freeze([
  "/var/lib/williamos/fabric/ledger/resident-aegis-mutation.lock",
  "/var/lib/williamos/fabric/standing-hash-ledger/standing-hash-mutation.lock",
  LOCK_PATH,
]);
export const JOURNAL_PREFIX =
  "/var/lib/williamos-aegis-ssh-coexistence-repair-";

const MACHINE_ID_SHA256 =
  "1b490fe20bf3d61dc1f14e3a6e7fe38fc7de69c14face211fdd5afd0544c9c8b";
const LIVE_STANDING_KEY = Object.freeze({
  recordSha256:
    "d054724aeea3ff42bf646d4d3aed078be21183e3a67c9ae1f8d4768e97dd2967",
  fingerprint: "SHA256:dlhYn3gjgDUQ09vFt583lXl2JKMhyFQMVoFE0sQpa48",
});
const LIVE_ENTRYPOINT_SHA256 =
  "ebcf0d068e11c1a3f98b515f9a59a456955d8d30abdbb8bab7897b9b315caf9a";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_BYTES = 1024 * 1024;
const FAILED_RECOVERY_AUTHORITY_ID = "babd50b8-b42c-4fef-bd4f-39c152256ddc";
const FAILED_RECOVERY_AUTHORITY_SHA256 =
  "f01b973bad66b1facd92e116f476ec854a6b6632de5ea28c163ee1cceff53623";
const FAILED_RECOVERY_MANIFEST_SHA256 =
  "3aa8f73203cbf7e5b89c91cbbdc421e2d2eeef3e00bd3a085d4c2715f4267761";
const FAILED_RECOVERY_FIRST_RECORD = Object.freeze({
  authority_id: FAILED_RECOVERY_AUTHORITY_ID,
  authority_sha256: FAILED_RECOVERY_AUTHORITY_SHA256,
  consumed_at: "2026-08-12T16:35:05.184Z",
  manifest_sha256: FAILED_RECOVERY_MANIFEST_SHA256,
  phase: 0,
  record_type: "AUTHORITY_CONSUMED",
  schema_version: "1.0-aegis-ssh-coexistence-repair-journal",
});
const TRUSTED_SERVICE_PARENTS = Object.freeze([
  Object.freeze({
    path: "/home/williamos-fabric",
    uid: 999,
    gid: 987,
    mode: "0755",
  }),
  Object.freeze({
    path: "/home/williamos-fabric/.ssh",
    uid: 999,
    gid: 987,
    mode: "0700",
  }),
  Object.freeze({
    path: "/var/lib/williamos",
    uid: 999,
    gid: 987,
    mode: "0750",
  }),
  Object.freeze({
    path: "/var/lib/williamos/fabric",
    uid: 999,
    gid: 987,
    mode: "0700",
  }),
  Object.freeze({
    path: "/var/lib/williamos/fabric/ledger",
    uid: 999,
    gid: 987,
    mode: "0700",
  }),
  Object.freeze({
    path: "/var/lib/williamos/fabric/standing-hash-ledger",
    uid: 999,
    gid: 987,
    mode: "0700",
  }),
]);
const AUTHORITY_KEYS = Object.freeze([
  "schemaVersion",
  "authorityId",
  "repairId",
  "manifestSha256",
  "machineIdSha256",
  "predecessorConfigSha256",
  "standingAuthorizedKeySha256",
  "standingEntrypointSha256",
  "reviewedConfigSha256",
  "installerSha256",
  "launcherSha256",
  "issuedAt",
  "expiresAt",
  "singleUse",
  "consumed",
]);
const RECOVERY_AUTHORITY_KEYS = Object.freeze([
  "schemaVersion",
  "operation",
  "authorityId",
  "repairId",
  "manifestSha256",
  "machineIdSha256",
  "failedAuthorityId",
  "failedAuthoritySha256",
  "failedManifestSha256",
  "predecessorConfigSha256",
  "standingAuthorizedKeySha256",
  "standingEntrypointSha256",
  "installerSha256",
  "launcherSha256",
  "issuedAt",
  "expiresAt",
  "resumeExpiresAt",
  "singleUse",
  "consumed",
]);
const EFFECTIVE_RESTRICTIONS = Object.freeze([
  "passwordauthentication no",
  "kbdinteractiveauthentication no",
  "hostbasedauthentication no",
  "pubkeyauthentication yes",
  "authenticationmethods publickey",
  "forcecommand none",
  "allowagentforwarding no",
  "allowtcpforwarding no",
  "x11forwarding no",
  "permittty no",
  "permittunnel no",
  "gatewayports no",
  "permituserenvironment no",
  "permituserrc no",
  `authorizedkeysfile ${REMOTE_DEV_KEY_PATH} ${STANDING_ROOT_KEY_PATH}`,
  "authorizedkeyscommand none",
  "authorizedprincipalscommand none",
  "trustedusercakeys none",
]);

export class AegisSshCoexistenceRepairError extends Error {
  constructor(code, detail, state = {}) {
    super(`${code}: ${detail}`);
    this.name = "AegisSshCoexistenceRepairError";
    this.code = code;
    Object.assign(this, state);
  }
}
function fail(code, detail, state = {}) {
  throw new AegisSshCoexistenceRepairError(code, detail, state);
}
const sha256 = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
export function canonicalizeRepairJcs(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value))
    return `[${value.map(canonicalizeRepairJcs).join(",")}]`;
  if (!value || typeof value !== "object")
    throw new TypeError("unsupported JCS value");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeRepairJcs(value[key])}`)
    .join(",")}}`;
}
const same = (a, b) => canonicalizeRepairJcs(a) === canonicalizeRepairJcs(b);
const recordBytes = (value) =>
  Buffer.from(`${canonicalizeRepairJcs(value)}\n`, "utf8");
const canonicalSha256 = (value) =>
  sha256(Buffer.from(canonicalizeRepairJcs(value)));
const exactKeys = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  same(Object.keys(value).sort(), [...keys].sort());
const canonicalTimestamp = (value) =>
  typeof value === "string" &&
  Number.isFinite(Date.parse(value)) &&
  new Date(Date.parse(value)).toISOString() === value;
function parseJson(bytes, code, label) {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    fail(code, `${label} is not JSON`);
  }
}

function validateReviewedConfig(bytes, manifest) {
  const text = Buffer.from(bytes).toString("utf8");
  if (
    sha256(bytes) !== manifest.reviewedConfig.sha256 ||
    !text.includes(
      `AuthorizedKeysFile ${REMOTE_DEV_KEY_PATH} ${STANDING_ROOT_KEY_PATH}`,
    ) ||
    /^\s*(?:ForceCommand|PermitUserEnvironment)\b/m.test(text)
  )
    fail("AEGIS_SSH_REPAIR_PACKAGE_DRIFT", "reviewed SSH config differs");
  for (const required of [
    "AuthenticationMethods publickey",
    "AllowAgentForwarding no",
    "AllowTcpForwarding no",
    "X11Forwarding no",
    "PermitTTY no",
    "PermitTunnel no",
    "GatewayPorts no",
    "PermitUserRC no",
  ])
    if (!text.includes(required))
      fail(
        "AEGIS_SSH_REPAIR_PACKAGE_DRIFT",
        `reviewed SSH restriction missing: ${required}`,
      );
}
function parseStandingRecord(bytes, manifest) {
  if (
    !Buffer.isBuffer(bytes) ||
    sha256(bytes) !== manifest.standingKey.recordSha256 ||
    !bytes.toString("utf8").endsWith("\n") ||
    bytes.toString("utf8").slice(0, -1).includes("\n")
  )
    fail("AEGIS_SSH_REPAIR_STANDING_KEY_DRIFT", "standing key bytes differ");
  const line = bytes.toString("utf8").slice(0, -1);
  const marker = line.indexOf(" ssh-ed25519 ");
  if (
    marker < 1 ||
    !same(
      line.slice(0, marker).split(","),
      manifest.standingKey.authorizedKeyOptions,
    )
  )
    fail(
      "AEGIS_SSH_REPAIR_STANDING_KEY_DRIFT",
      "standing command envelope differs",
    );
  const encoded = line.slice(marker + 13);
  if (encoded.includes(" "))
    fail(
      "AEGIS_SSH_REPAIR_STANDING_KEY_DRIFT",
      "standing key encoding differs",
    );
  const blob = Buffer.from(encoded, "base64");
  if (
    `SHA256:${crypto.createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}` !==
    manifest.standingKey.fingerprint
  )
    fail(
      "AEGIS_SSH_REPAIR_STANDING_KEY_DRIFT",
      "standing key fingerprint differs",
    );
}

export function validateAegisSshCoexistenceRepairManifest(
  manifest,
  {
    assetBytes,
    installerBytes,
    launcherBytes,
    standingKeyBinding = LIVE_STANDING_KEY,
    entrypointSha256 = LIVE_ENTRYPOINT_SHA256,
  } = {},
) {
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.repairId !== "aegis-ssh-coexistence-repair-issue-595-v1" ||
    manifest.status !== "FINAL_REVIEWED_ONE_SHOT_PACKAGE" ||
    manifest.issue?.repository !== "bsvalues/terragroq" ||
    manifest.issue?.number !== 595
  )
    fail("AEGIS_SSH_REPAIR_MANIFEST_INVALID", "package identity differs");
  if (
    !same(manifest.identity, {
      hostname: "aegis",
      machineIdSha256: MACHINE_ID_SHA256,
      effectiveUid: 0,
      account: "williamos-fabric",
      uid: 999,
      gid: 987,
      home: "/var/empty/williamos-fabric",
      shell: "/bin/bash",
    })
  )
    fail("AEGIS_SSH_REPAIR_MANIFEST_INVALID", "fixed AEGIS identity differs");
  const predecessor = Buffer.from(
    manifest.predecessor?.configBase64 ?? "",
    "base64",
  );
  if (
    manifest.predecessor?.path !== CONFIG_PATH ||
    manifest.predecessor?.sha256 !==
      "a6e83ce0c8b2d2c8127a268c5bd48f27ff3199894f0179afc412a5b01f7fe9c6" ||
    manifest.predecessor?.owner !== "root" ||
    manifest.predecessor?.group !== "root" ||
    manifest.predecessor?.mode !== "0444" ||
    sha256(predecessor) !== manifest.predecessor.sha256
  )
    fail("AEGIS_SSH_REPAIR_MANIFEST_INVALID", "predecessor binding differs");
  if (
    manifest.standingKey?.sourcePath !== HOME_KEY_PATH ||
    manifest.standingKey?.destinationPath !== STANDING_ROOT_KEY_PATH ||
    manifest.standingKey?.recordSha256 !== standingKeyBinding.recordSha256 ||
    manifest.standingKey?.fingerprint !== standingKeyBinding.fingerprint ||
    manifest.standingKey?.sourceOwner !== "williamos-fabric" ||
    manifest.standingKey?.sourceGroup !== "williamos-fabric" ||
    manifest.standingKey?.sourceMode !== "0600" ||
    manifest.standingKey?.destinationOwner !== "root" ||
    manifest.standingKey?.destinationGroup !== "root" ||
    manifest.standingKey?.destinationMode !== "0444"
  )
    fail("AEGIS_SSH_REPAIR_MANIFEST_INVALID", "standing key binding differs");
  if (
    manifest.standingEntrypoint?.path !== STANDING_ENTRYPOINT_PATH ||
    manifest.standingEntrypoint?.sha256 !== entrypointSha256 ||
    manifest.standingEntrypoint?.owner !== "root" ||
    manifest.standingEntrypoint?.group !== "root" ||
    manifest.standingEntrypoint?.mode !== "0555" ||
    manifest.standingEntrypoint?.trustedParentChain !== true
  )
    fail(
      "AEGIS_SSH_REPAIR_MANIFEST_INVALID",
      "standing entrypoint binding differs",
    );
  if (
    manifest.reviewedConfig?.sourcePath !== REVIEWED_CONFIG_ASSET ||
    manifest.reviewedConfig?.destinationPath !== CONFIG_PATH ||
    !SHA256.test(manifest.reviewedConfig?.sha256 ?? "") ||
    manifest.installer?.sourcePath !== INSTALLER_PATH ||
    manifest.installer?.installedPath !== INSTALLED_INSTALLER_PATH ||
    !SHA256.test(manifest.installer?.sha256 ?? "") ||
    manifest.launcher?.sourcePath !== LAUNCHER_PATH ||
    manifest.launcher?.executedPath !==
      `/usr/local/share/williamos/aegis-ssh-coexistence-repair-bundle/${LAUNCHER_PATH}` ||
    !SHA256.test(manifest.launcher?.sha256 ?? "") ||
    manifest.launcher?.owner !== "root" ||
    manifest.launcher?.group !== "root" ||
    manifest.launcher?.mode !== "0555"
  )
    fail(
      "AEGIS_SSH_REPAIR_MANIFEST_INVALID",
      "reviewed package binding differs",
    );
  if (
    !same(manifest.trustedServiceParents, TRUSTED_SERVICE_PARENTS) ||
    !same(manifest.reservationLocks, RESERVATION_LOCK_PATHS) ||
    manifest.kernelLock?.path !== KERNEL_LOCK_PATH ||
    manifest.kernelLock?.owner !== "root" ||
    manifest.kernelLock?.group !== "root" ||
    manifest.kernelLock?.mode !== "0600" ||
    manifest.kernelLock?.mechanism !== "FLOCK_INHERITED_FD"
  )
    fail(
      "AEGIS_SSH_REPAIR_MANIFEST_INVALID",
      "parent or reservation binding differs",
    );
  if (
    manifest.authProof?.root !== AUTH_PROOF_ROOT ||
    manifest.authProof?.result !== "STANDING_AUTHENTICATED" ||
    manifest.authProof?.sourceAddress !== "192.168.88.9" ||
    manifest.authProof?.owner !== "root" ||
    manifest.authProof?.group !== "root" ||
    manifest.authProof?.mode !== "0600" ||
    manifest.authProof?.challengeNonceBytes !== 32 ||
    manifest.authProof?.maximumAgeSeconds !== 900
  )
    fail("AEGIS_SSH_REPAIR_MANIFEST_INVALID", "proof binding differs");
  if (!same(manifest.failedRecovery, {
    operations: ["SETTLE_FAILED_RECOVERY", "SETTLE_POST_MUTATION"],
    failedAuthorityId: FAILED_RECOVERY_AUTHORITY_ID,
    failedAuthoritySha256: FAILED_RECOVERY_AUTHORITY_SHA256,
    failedManifestSha256: FAILED_RECOVERY_MANIFEST_SHA256,
    normalSshProofSuffix: ".recovery.json",
    maximumResumeSeconds: 1800,
  })) fail("AEGIS_SSH_REPAIR_MANIFEST_INVALID", "failed recovery binding differs");
  if (
    manifest.inactivity?.workerUnitPattern !==
    "^williamos-aegis-remote-dev-[0-9a-f-]{36}\\.service$"
  )
    fail("AEGIS_SSH_REPAIR_MANIFEST_INVALID", "worker unit pattern differs");
  if (
    !same(manifest.mutations, [
      "CREATE_AUTHORIZED_KEYS_DIRECTORY",
      "COPY_STANDING_KEY_TO_ROOT",
      "REPLACE_SSHD_CONFIG",
      "RELOAD_SSHD",
    ]) ||
    manifest.evidence?.schedulerActivated !== false ||
    manifest.evidence?.workloadExecuted !== false ||
    manifest.evidence?.networkAccessed !== false
  )
    fail("AEGIS_SSH_REPAIR_MANIFEST_INVALID", "repair envelope differs");
  if (assetBytes) validateReviewedConfig(assetBytes, manifest);
  if (installerBytes && sha256(installerBytes) !== manifest.installer.sha256)
    fail("AEGIS_SSH_REPAIR_PACKAGE_DRIFT", "installer digest differs");
  if (launcherBytes && sha256(launcherBytes) !== manifest.launcher.sha256)
    fail("AEGIS_SSH_REPAIR_PACKAGE_DRIFT", "launcher digest differs");
  return structuredClone(manifest);
}

function validateAuthority(authority, manifest, manifestBytes, now, resume) {
  if (
    !exactKeys(authority, AUTHORITY_KEYS) ||
    authority.schemaVersion !== 1 ||
    !UUID.test(authority.authorityId ?? "") ||
    authority.repairId !== manifest.repairId ||
    authority.manifestSha256 !== sha256(manifestBytes) ||
    authority.machineIdSha256 !== MACHINE_ID_SHA256 ||
    authority.predecessorConfigSha256 !== manifest.predecessor.sha256 ||
    authority.standingAuthorizedKeySha256 !==
      manifest.standingKey.recordSha256 ||
    authority.standingEntrypointSha256 !== manifest.standingEntrypoint.sha256 ||
    authority.reviewedConfigSha256 !== manifest.reviewedConfig.sha256 ||
    authority.installerSha256 !== manifest.installer.sha256 ||
    authority.launcherSha256 !== manifest.launcher.sha256 ||
    authority.singleUse !== true ||
    authority.consumed !== false ||
    !canonicalTimestamp(authority.issuedAt) ||
    !canonicalTimestamp(authority.expiresAt)
  )
    fail("AEGIS_SSH_REPAIR_AUTHORITY_INVALID", "authority binding differs");
  if (!resume) {
    const issued = Date.parse(authority.issuedAt),
      expires = Date.parse(authority.expiresAt),
      current = Date.parse(now);
    if (
      issued > current ||
      current >= expires ||
      expires - issued > manifest.authority.maximumAgeSeconds * 1000
    )
      fail(
        "AEGIS_SSH_REPAIR_AUTHORITY_EXPIRED",
        "authority is stale or future-dated",
      );
  }
}
function validateRecoveryAuthority(authority, manifest, manifestBytes, now, resume) {
  if (
    !exactKeys(authority, RECOVERY_AUTHORITY_KEYS) ||
    authority.schemaVersion !== 1 ||
    !manifest.failedRecovery.operations.includes(authority.operation) ||
    !UUID.test(authority.authorityId ?? "") ||
    authority.authorityId === FAILED_RECOVERY_AUTHORITY_ID ||
    authority.repairId !== manifest.repairId ||
    authority.manifestSha256 !== sha256(manifestBytes) ||
    authority.machineIdSha256 !== MACHINE_ID_SHA256 ||
    authority.failedAuthorityId !== FAILED_RECOVERY_AUTHORITY_ID ||
    authority.failedAuthoritySha256 !== FAILED_RECOVERY_AUTHORITY_SHA256 ||
    authority.failedManifestSha256 !== FAILED_RECOVERY_MANIFEST_SHA256 ||
    authority.predecessorConfigSha256 !== manifest.predecessor.sha256 ||
    authority.standingAuthorizedKeySha256 !== manifest.standingKey.recordSha256 ||
    authority.standingEntrypointSha256 !== manifest.standingEntrypoint.sha256 ||
    authority.installerSha256 !== manifest.installer.sha256 ||
    authority.launcherSha256 !== manifest.launcher.sha256 ||
    authority.singleUse !== true ||
    authority.consumed !== false ||
    !canonicalTimestamp(authority.issuedAt) ||
    !canonicalTimestamp(authority.expiresAt) ||
    !canonicalTimestamp(authority.resumeExpiresAt)
  ) fail("AEGIS_SSH_REPAIR_RECOVERY_AUTHORITY_INVALID", "recovery authority binding differs");
  const issued = Date.parse(authority.issuedAt), expires = Date.parse(authority.expiresAt),
    resumeExpires = Date.parse(authority.resumeExpiresAt), current = Date.parse(now);
  if (issued > current || expires <= issued || resumeExpires < expires ||
      resumeExpires - issued > manifest.failedRecovery.maximumResumeSeconds * 1000)
    fail("AEGIS_SSH_REPAIR_RECOVERY_AUTHORITY_INVALID", "recovery authority window differs");
  if ((!resume && current >= expires) || (resume && current >= resumeExpires))
    fail("AEGIS_SSH_REPAIR_AUTHORITY_EXPIRED", "recovery authority is stale or future-dated");
}
function assertFile(io, target, expected, code) {
  if (io.parentsTrusted && !io.parentsTrusted(target))
    fail(code, `${target} parent chain differs`);
  const observed = io.inspect(target);
  if (
    !observed ||
    observed.type !== "file" ||
    !observed.direct ||
    observed.nlink !== 1 ||
    observed.uid !== expected.uid ||
    observed.gid !== expected.gid ||
    observed.mode !== expected.mode
  )
    fail(code, `${target} bytes or metadata differ`);
  const bytes = io.readStable
    ? io.readStable(target, expected, code)
    : io.read(target);
  if (sha256(bytes) !== expected.sha256)
    fail(code, `${target} bytes or metadata differ`);
  return bytes;
}
function assertDirectory(io, target, expected, code) {
  if (io.parentsTrusted && !io.parentsTrusted(target)) fail(code, `${target} parent chain differs`);
  const observed = io.inspect(target);
  if (!observed || observed.type !== "directory" || !observed.direct ||
      observed.uid !== expected.uid || observed.gid !== expected.gid || observed.mode !== expected.mode)
    fail(code, `${target} metadata differs`);
  return observed;
}
function journalRecords(io, target) {
  const observed = io.inspect(target);
  if (!observed) return [];
  const bytes = assertFile(
    io,
    target,
    { uid: 0, gid: 0, mode: 0o600, sha256: sha256(io.read(target)) },
    "AEGIS_SSH_REPAIR_JOURNAL_UNTRUSTED",
  );
  try {
    const lines = bytes.toString("utf8").trim().split("\n").filter(Boolean),
      records = lines.map(JSON.parse);
    if (
      !lines.every((line, index) =>
        Buffer.from(`${line}\n`).equals(recordBytes(records[index])),
      )
    )
      throw new Error("noncanonical");
    const phases = records.map((record) => record.record_type),
      challengeIndex = phases.indexOf("AUTH_PROBE_CHALLENGE_ISSUED"),
      mutationIndex = phases.indexOf("MUTATED_AWAITING_AUTH_PROBE"),
      committedIndex = phases.indexOf("COMMITTED");
    if (
      phases[0] !== "AUTHORITY_CONSUMED" ||
      phases
        .slice(1)
        .some(
          (phase) =>
            ![
              "MUTATED_AWAITING_AUTH_PROBE",
              "AUTH_PROBE_CHALLENGE_ISSUED",
              "LOCK_RELEASE_PROVEN_AWAITING_AUTH_PROBE",
              "COMMITTED",
              "LOCK_RELEASE_PROVEN",
              "FAILED_PARTIAL",
              "FAILED_LOCK_RELEASE_PROVEN",
            ].includes(phase),
        ) ||
      phases.filter((phase) => phase === "AUTH_PROBE_CHALLENGE_ISSUED").length >
        1 ||
      phases.filter((phase) => phase === "COMMITTED").length > 1 ||
      challengeIndex < mutationIndex ||
      (committedIndex >= 0 && challengeIndex < 0) ||
      (committedIndex >= 0 && committedIndex < challengeIndex) ||
      (phases.includes("FAILED_PARTIAL") && phases.includes("COMMITTED"))
    )
      throw new Error("phase sequence");
    const challenge = records[challengeIndex];
    if (
      challenge &&
      (!/^[a-f0-9]{64}$/.test(challenge.challenge_nonce ?? "") ||
        !canonicalTimestamp(challenge.challenge_issued_at))
    )
      throw new Error("challenge record");
    return records;
  } catch {
    fail("AEGIS_SSH_REPAIR_JOURNAL_UNTRUSTED", "journal records differ");
  }
}
function verifyEffective(io) {
  for (const address of ["192.168.88.9", "192.168.1.154"]) {
    const effective = io.effectiveSshd(address).toLowerCase();
    for (const required of EFFECTIVE_RESTRICTIONS)
      if (!effective.includes(required))
        fail(
          "AEGIS_SSH_REPAIR_SSHD_INVALID",
          `effective SSH restriction differs: ${required}`,
        );
  }
}
function assertInactive(io, manifest, account, lockBytes, held) {
  for (const target of manifest.inactivity.absentPaths) {
    if (RESERVATION_LOCK_PATHS.includes(target)) {
      if (held)
        assertFile(
          io,
          target,
          { uid: 0, gid: 0, mode: 0o600, sha256: sha256(lockBytes) },
          "AEGIS_SSH_REPAIR_RESERVATION_DRIFT",
        );
    } else if (io.inspect(target))
      fail(
        "AEGIS_SSH_REPAIR_INACTIVE_STATE_REQUIRED",
        `${target} must be absent`,
      );
  }
  if (
    !io.remoteDevInactive(manifest.inactivity, account) ||
    !io.workerUnitsInactive(manifest.inactivity.workerUnitPattern)
  )
    fail(
      "AEGIS_SSH_REPAIR_INACTIVE_STATE_REQUIRED",
      "activation, service, worker, lease, or ticket exists",
    );
}
function exactPost(io, manifest) {
  assertDirectory(io, AUTHORIZED_KEYS_ROOT, { uid: 0, gid: 0, mode: 0o755 }, "AEGIS_SSH_REPAIR_POST_STATE_DRIFT");
  assertFile(
    io,
    STANDING_ROOT_KEY_PATH,
    { uid: 0, gid: 0, mode: 0o444, sha256: manifest.standingKey.recordSha256 },
    "AEGIS_SSH_REPAIR_POST_STATE_DRIFT",
  );
  assertFile(
    io,
    CONFIG_PATH,
    { uid: 0, gid: 0, mode: 0o444, sha256: manifest.reviewedConfig.sha256 },
    "AEGIS_SSH_REPAIR_POST_STATE_DRIFT",
  );
  assertFile(
    io,
    STANDING_ENTRYPOINT_PATH,
    { uid: 0, gid: 0, mode: 0o555, sha256: manifest.standingEntrypoint.sha256 },
    "AEGIS_SSH_REPAIR_ENTRYPOINT_DRIFT",
  );
}
function proof(io, manifest, authority, challenge, now) {
  const value = io.standingAuthProof?.(
    `${AUTH_PROOF_ROOT}/${authority.authorityId}.json`,
    challenge,
  );
  if (value == null) return null;
  const expected = {
    schemaVersion: 2,
    authorityId: authority.authorityId,
    repairId: manifest.repairId,
    result: manifest.authProof.result,
    sourceAddress: manifest.authProof.sourceAddress,
    standingKeySha256: manifest.standingKey.recordSha256,
    standingEntrypointSha256: manifest.standingEntrypoint.sha256,
    reviewedConfigSha256: manifest.reviewedConfig.sha256,
    challengeNonce: challenge.challenge_nonce,
    challengeIssuedAt: challenge.challenge_issued_at,
    authenticatedAt: value.authenticatedAt,
  };
  if (
    !canonicalTimestamp(value.authenticatedAt) ||
    Date.parse(value.authenticatedAt) <=
      Date.parse(challenge.challenge_issued_at) ||
    Date.parse(value.authenticatedAt) > Date.parse(now) ||
    Date.parse(value.authenticatedAt) -
      Date.parse(challenge.challenge_issued_at) >
      manifest.authProof.maximumAgeSeconds * 1000 ||
    !same(value, expected)
  )
    fail(
      "AEGIS_SSH_REPAIR_AUTH_PROOF_INVALID",
      "standing authentication proof differs",
    );
  return value;
}

function basePreflight({
  manifest,
  manifestBytes,
  authority,
  assetBytes,
  assetSourcePath,
  installerBytes,
  launcherBytes,
  standingKeyBinding,
  entrypointSha256,
  io,
  now,
  machineIdentitySha256,
  resume,
  recovery = false,
}) {
  validateAegisSshCoexistenceRepairManifest(manifest, {
    assetBytes,
    installerBytes,
    launcherBytes,
    standingKeyBinding,
    entrypointSha256,
  });
  if (recovery) validateRecoveryAuthority(authority, manifest, manifestBytes, now, resume);
  else validateAuthority(authority, manifest, manifestBytes, now, resume);
  if (io.platform() !== "linux")
    fail("AEGIS_SSH_REPAIR_LINUX_REQUIRED", "Linux required");
  if (io.euid() !== 0) fail("AEGIS_SSH_REPAIR_ROOT_REQUIRED", "root required");
  if (!io.kernelLockHeld?.())
    fail(
      "AEGIS_SSH_REPAIR_KERNEL_LOCK_REQUIRED",
      "inherited kernel reservation is required",
    );
  if (
    io.hostname() !== manifest.identity.hostname ||
    machineIdentitySha256 !== manifest.identity.machineIdSha256
  )
    fail("AEGIS_SSH_REPAIR_HOST_REJECTED", "fixed AEGIS identity differs");
  const account = io.account(manifest.identity.account);
  if (
    !same(account, {
      uid: 999,
      gid: 987,
      home: "/var/empty/williamos-fabric",
      shell: "/bin/bash",
    })
  )
    fail("AEGIS_SSH_REPAIR_ACCOUNT_DRIFT", "account differs");
  const standingBytes = assertFile(
    io,
    HOME_KEY_PATH,
    {
      uid: 999,
      gid: 987,
      mode: 0o600,
      sha256: manifest.standingKey.recordSha256,
    },
    "AEGIS_SSH_REPAIR_STANDING_KEY_DRIFT",
  );
  parseStandingRecord(standingBytes, manifest);
  assertFile(
    io,
    STANDING_ENTRYPOINT_PATH,
    { uid: 0, gid: 0, mode: 0o555, sha256: manifest.standingEntrypoint.sha256 },
    "AEGIS_SSH_REPAIR_ENTRYPOINT_DRIFT",
  );
  if (!path.posix.isAbsolute(assetSourcePath ?? ""))
    fail(
      "AEGIS_SSH_REPAIR_PACKAGE_DRIFT",
      "reviewed SSH config path is not absolute",
    );
  io.validateStagedSshd(assetSourcePath, assetBytes);
  return {
    account,
    standingBytes,
    predecessorBytes: Buffer.from(manifest.predecessor.configBase64, "base64"),
  };
}

function recoveryJournalRecords(io, target, authority) {
  const observed = io.inspect(target);
  if (!observed) return [];
  const bytes = assertFile(io, target,
    { uid: 0, gid: 0, mode: 0o600, sha256: sha256(io.read(target)) },
    "AEGIS_SSH_REPAIR_RECOVERY_JOURNAL_UNTRUSTED");
  try {
    const lines = bytes.toString("utf8").trim().split("\n").filter(Boolean);
    const records = lines.map(JSON.parse);
    if (!lines.every((line, index) => Buffer.from(`${line}\n`).equals(recordBytes(records[index])))) throw new Error("noncanonical");
    const phases = records.map((record) => record.record_type);
    if (!same(phases, ["AUTHORITY_CONSUMED"]) &&
        !same(phases, ["AUTHORITY_CONSUMED", "RECOVERY_CHALLENGE_ISSUED"]) &&
        !same(phases, ["AUTHORITY_CONSUMED", "RECOVERY_CHALLENGE_ISSUED", "LOCK_RELEASE_PROVEN_AWAITING_AUTH_PROBE"]) &&
        !same(phases, ["AUTHORITY_CONSUMED", "RECOVERY_CHALLENGE_ISSUED", "LOCK_RELEASE_PROVEN_AWAITING_AUTH_PROBE", "NORMAL_SSH_PROOF_INTENT"]) &&
        !same(phases, ["AUTHORITY_CONSUMED", "RECOVERY_CHALLENGE_ISSUED", "LOCK_RELEASE_PROVEN_AWAITING_AUTH_PROBE", "NORMAL_SSH_PROOF_INTENT", "NORMAL_SSH_PROOF_RECORDED"]) &&
        !same(phases, ["AUTHORITY_CONSUMED", "RECOVERY_CHALLENGE_ISSUED", "LOCK_RELEASE_PROVEN_AWAITING_AUTH_PROBE", "NORMAL_SSH_PROOF_INTENT", "NORMAL_SSH_PROOF_RECORDED", "COMMITTED"]) &&
        !same(phases, ["AUTHORITY_CONSUMED", "RECOVERY_CHALLENGE_ISSUED", "LOCK_RELEASE_PROVEN_AWAITING_AUTH_PROBE", "NORMAL_SSH_PROOF_INTENT", "NORMAL_SSH_PROOF_RECORDED", "COMMITTED", "LOCK_RELEASE_PROVEN"]) &&
        !same(phases, ["AUTHORITY_CONSUMED", "RECOVERY_CHALLENGE_ISSUED", "LOCK_RELEASE_PROVEN_AWAITING_AUTH_PROBE", "COMMITTED"]) &&
        !same(phases, ["AUTHORITY_CONSUMED", "RECOVERY_CHALLENGE_ISSUED", "LOCK_RELEASE_PROVEN_AWAITING_AUTH_PROBE", "COMMITTED", "LOCK_RELEASE_PROVEN"]))
      throw new Error("phase sequence");
    const first = records[0];
    if (!exactKeys(first, ["schema_version", "record_type", "phase", "authority_id", "authority_sha256", "manifest_sha256", "failed_authority_id", "failed_authority_sha256", "failed_manifest_sha256", "consumed_at"]) ||
        first.schema_version !== "1.0-aegis-ssh-failed-recovery-journal" || first.record_type !== "AUTHORITY_CONSUMED" || first.phase !== 0 ||
        first.authority_id !== authority.authorityId || first.authority_sha256 !== canonicalSha256(authority) ||
        first.manifest_sha256 !== authority.manifestSha256 || first.failed_authority_id !== FAILED_RECOVERY_AUTHORITY_ID ||
        first.failed_authority_sha256 !== FAILED_RECOVERY_AUTHORITY_SHA256 || first.failed_manifest_sha256 !== FAILED_RECOVERY_MANIFEST_SHA256 ||
        !canonicalTimestamp(first.consumed_at)) throw new Error("claim record");
    const challenge = records.find((record) => record.record_type === "RECOVERY_CHALLENGE_ISSUED");
    if (challenge && (!exactKeys(challenge, ["record_type", "phase", "challenge_nonce", "challenge_issued_at", "daemon_identity"]) ||
        challenge.phase !== 1 || !/^[a-f0-9]{64}$/.test(challenge.challenge_nonce) ||
        !canonicalTimestamp(challenge.challenge_issued_at))) throw new Error("challenge record");
    if (challenge) validateDaemonIdentity(challenge.daemon_identity);
    for (const released of records.filter((record) => ["LOCK_RELEASE_PROVEN_AWAITING_AUTH_PROBE", "LOCK_RELEASE_PROVEN"].includes(record.record_type)))
      if (!exactKeys(released, ["record_type", "phase", "released_at", "reservation_locks"]) ||
          released.phase !== 3 || !canonicalTimestamp(released.released_at) || !same(released.reservation_locks, RESERVATION_LOCK_PATHS))
        throw new Error("release record");
    const committed = records.find((record) => record.record_type === "COMMITTED");
    if (committed && (!exactKeys(committed, ["record_type", "phase", "committed_at", "failed_authority_id", "failed_journal_terminal", "daemon_identity", "normal_ssh_proof_sha256", "scheduler_activated", "workload_executed", "network_accessed"]) ||
        committed.phase !== 2 || !canonicalTimestamp(committed.committed_at) || committed.failed_authority_id !== FAILED_RECOVERY_AUTHORITY_ID ||
        committed.failed_journal_terminal !== "FAILED_LOCK_RELEASE_PROVEN" || !SHA256.test(committed.normal_ssh_proof_sha256) ||
        committed.scheduler_activated !== false || committed.workload_executed !== false || committed.network_accessed !== false))
      throw new Error("commit record");
    if (committed) validateDaemonIdentity(committed.daemon_identity);
    const produced = records.find((record) => record.record_type === "NORMAL_SSH_PROOF_RECORDED");
    const proofIntent = records.find((record) => record.record_type === "NORMAL_SSH_PROOF_INTENT");
    if (proofIntent && (!exactKeys(proofIntent, ["record_type", "phase", "intended_at", "proof_sha256", "proof"]) ||
        proofIntent.phase !== 2 || !canonicalTimestamp(proofIntent.intended_at) ||
        proofIntent.proof_sha256 !== canonicalSha256(proofIntent.proof))) throw new Error("proof intent record");
    if (produced && (!exactKeys(produced, ["record_type", "phase", "recorded_at", "proof_sha256", "session"]) ||
        produced.phase !== 2 || !canonicalTimestamp(produced.recorded_at) || !SHA256.test(produced.proof_sha256)))
      throw new Error("proof producer record");
    if (produced) validateSshSessionEvidence(produced.session);
    if (produced && (!proofIntent || produced.proof_sha256 !== proofIntent.proof_sha256 ||
        !same(produced.session, proofIntent.proof.session) || produced.recorded_at !== proofIntent.proof.authenticatedAt))
      throw new Error("proof completion binding");
    if (committed && produced && (committed.normal_ssh_proof_sha256 !== produced.proof_sha256 ||
        !same(committed.daemon_identity, challenge.daemon_identity)))
      throw new Error("commit producer binding");
    return records;
  } catch {
    fail("AEGIS_SSH_REPAIR_RECOVERY_JOURNAL_UNTRUSTED", "recovery journal records differ");
  }
}

function exactFailedJournal(io) {
  const target = `${JOURNAL_PREFIX}${FAILED_RECOVERY_AUTHORITY_ID}.journal.jsonl`;
  const records = journalRecords(io, target);
  const phases = records.map((record) => record.record_type);
  if (!same(records[0], FAILED_RECOVERY_FIRST_RECORD) ||
      (!same(phases, ["AUTHORITY_CONSUMED"]) &&
       !same(phases, ["AUTHORITY_CONSUMED", "FAILED_PARTIAL"]) &&
       !same(phases, ["AUTHORITY_CONSUMED", "FAILED_PARTIAL", "FAILED_LOCK_RELEASE_PROVEN"])))
    fail("AEGIS_SSH_REPAIR_RECOVERY_JOURNAL_UNTRUSTED", "failed transaction journal differs");
  const failed = records[1];
  const rolledBack = failed?.failure_code === "ENOENT";
  const postMutation = failed?.failure_code === "POST_MUTATION_SETTLED";
  if (failed && (!exactKeys(failed, ["record_type", "phase", "failed_at", "failure_code", "predecessor_config_restored", "standing_root_key_removed", "authorized_keys_directory_removed", "post_mutation_state_preserved", "daemon_identity_unchanged", "reload_evidence", "normal_ssh_proof_sha256", "lock_release_proven", "scheduler_activated", "workload_executed", "network_accessed"]) ||
      failed.record_type !== "FAILED_PARTIAL" || failed.phase !== 3 || !canonicalTimestamp(failed.failed_at) ||
      (!rolledBack && !postMutation) || failed.predecessor_config_restored !== rolledBack ||
      failed.standing_root_key_removed !== rolledBack || failed.authorized_keys_directory_removed !== rolledBack ||
      failed.post_mutation_state_preserved !== postMutation || failed.daemon_identity_unchanged !== true ||
      !SHA256.test(failed.normal_ssh_proof_sha256 ?? "") || failed.lock_release_proven !== false ||
      failed.scheduler_activated !== false || failed.workload_executed !== false || failed.network_accessed !== false))
    fail("AEGIS_SSH_REPAIR_RECOVERY_JOURNAL_UNTRUSTED", "failed settlement record differs");
  if (failed && postMutation) validateReloadEvidence(failed.reload_evidence, failed.reload_evidence?.daemonIdentity);
  if (failed && rolledBack && failed.reload_evidence !== null)
    fail("AEGIS_SSH_REPAIR_RECOVERY_JOURNAL_UNTRUSTED", "rollback reload evidence differs");
  const released = records[2];
  if (released && (!exactKeys(released, ["record_type", "phase", "released_at", "reservation_locks"]) ||
      released.record_type !== "FAILED_LOCK_RELEASE_PROVEN" || released.phase !== 4 ||
      !canonicalTimestamp(released.released_at) || !same(released.reservation_locks, RESERVATION_LOCK_PATHS)))
    fail("AEGIS_SSH_REPAIR_RECOVERY_JOURNAL_UNTRUSTED", "failed release record differs");
  return { target, records };
}

function validateDaemonIdentity(value) {
  if (!exactKeys(value, ["mainPid", "startTimestampMonotonic"]) ||
      !Number.isSafeInteger(value.mainPid) || value.mainPid <= 1 ||
      typeof value.startTimestampMonotonic !== "string" || !/^[1-9][0-9]*$/.test(value.startTimestampMonotonic))
    fail("AEGIS_SSH_REPAIR_DAEMON_IDENTITY_DRIFT", "SSH daemon identity differs");
  return value;
}
function validateReloadEvidence(value, daemon) {
  if (!exactKeys(value, ["daemonIdentity", "configCtime", "reloadAt", "ipv4ListeningAt", "ipv6ListeningAt"]) ||
      !same(value.daemonIdentity, daemon) || !canonicalTimestamp(value.configCtime) ||
      !canonicalTimestamp(value.reloadAt) || !canonicalTimestamp(value.ipv4ListeningAt) ||
      !canonicalTimestamp(value.ipv6ListeningAt) || Date.parse(value.reloadAt) < Date.parse(value.configCtime) ||
      Date.parse(value.ipv4ListeningAt) < Date.parse(value.reloadAt) || Date.parse(value.ipv6ListeningAt) < Date.parse(value.reloadAt))
    fail("AEGIS_SSH_REPAIR_RELOAD_EVIDENCE_INVALID", "SSH reload evidence differs");
  return value;
}
function validateSshSessionEvidence(value) {
  if (!exactKeys(value, ["sourceAddress", "sourcePort", "targetAddress", "targetPort", "socketInode", "loginUid",
    "auditSessionId", "sshdAncestorPid", "sshdAncestorStartTimeTicks", "sshdAncestorCmdlineSha256"]) ||
      value.sourceAddress !== "192.168.88.9" || value.targetAddress !== "192.168.88.6" ||
      !Number.isSafeInteger(value.sourcePort) || value.sourcePort < 1 || value.sourcePort > 65535 ||
      value.targetPort !== 22 || value.loginUid !== 1000 || !Number.isSafeInteger(value.auditSessionId) ||
      value.auditSessionId < 1 || !Number.isSafeInteger(value.sshdAncestorPid) || value.sshdAncestorPid <= 1 ||
      !/^[1-9][0-9]*$/.test(value.sshdAncestorStartTimeTicks ?? "") ||
      !SHA256.test(value.sshdAncestorCmdlineSha256 ?? "") || !/^[1-9][0-9]*$/.test(value.socketInode ?? ""))
    fail("AEGIS_SSH_REPAIR_AUTH_PROOF_INVALID", "normal SSH session provenance differs");
  return value;
}

export function recordRecoverySshProof({ manifest, manifestBytes, authority, io, assetBytes,
  assetSourcePath, installerBytes, launcherBytes, standingKeyBinding = LIVE_STANDING_KEY,
  entrypointSha256 = LIVE_ENTRYPOINT_SHA256, clock = () => new Date().toISOString(),
  machineIdentitySha256 }) {
  const recoveryJournalPath = `${JOURNAL_PREFIX}${authority.authorityId}.recovery.journal.jsonl`;
  const records = recoveryJournalRecords(io, recoveryJournalPath, authority);
  basePreflight({ manifest, manifestBytes, authority, assetBytes, assetSourcePath, installerBytes,
    launcherBytes, standingKeyBinding, entrypointSha256, io, now: clock(), machineIdentitySha256,
    resume: true, recovery: true });
  const challenge = records.find((record) => record.record_type === "RECOVERY_CHALLENGE_ISSUED");
  const released = records.find((record) => record.record_type === "LOCK_RELEASE_PROVEN_AWAITING_AUTH_PROBE");
  const intent = records.find((record) => record.record_type === "NORMAL_SSH_PROOF_INTENT");
  const recorded = records.find((record) => record.record_type === "NORMAL_SSH_PROOF_RECORDED");
  if (!challenge || !released || !["LOCK_RELEASE_PROVEN_AWAITING_AUTH_PROBE", "NORMAL_SSH_PROOF_INTENT", "NORMAL_SSH_PROOF_RECORDED"].includes(records.at(-1)?.record_type))
    fail("AEGIS_SSH_REPAIR_RECOVERY_JOURNAL_UNTRUSTED", "recovery proof is not awaited");
  const daemon = validateDaemonIdentity(io.sshDaemonIdentity());
  if (!same(daemon, challenge.daemon_identity))
    fail("AEGIS_SSH_REPAIR_DAEMON_IDENTITY_DRIFT", "SSH daemon changed before normal session proof");
  let proof = intent?.proof;
  if (!proof) {
    const session = validateSshSessionEvidence(io.sshSessionEvidence());
    const authenticatedAt = clock();
    validateRecoveryAuthority(authority, manifest, manifestBytes, authenticatedAt, true);
    if (Date.parse(authenticatedAt) <= Date.parse(released.released_at))
      fail("AEGIS_SSH_REPAIR_AUTH_PROOF_INVALID", "normal SSH proof predates release");
    proof = { schemaVersion: 2, operation: "NORMAL_SSH_AUTHENTICATED",
      producer: INSTALLED_INSTALLER_PATH, producerSha256: manifest.installer.sha256,
      recoveryAuthorityId: authority.authorityId, failedAuthorityId: FAILED_RECOVERY_AUTHORITY_ID,
      challengeNonce: challenge.challenge_nonce, challengeIssuedAt: challenge.challenge_issued_at,
      releaseProvenAt: released.released_at, daemonIdentity: daemon, session, authenticatedAt };
    io.appendJournal(recoveryJournalPath, { record_type: "NORMAL_SSH_PROOF_INTENT", phase: 2,
      intended_at: authenticatedAt, proof_sha256: canonicalSha256(proof), proof });
  }
  const target = `${AUTH_PROOF_ROOT}/${authority.authorityId}${manifest.failedRecovery.normalSshProofSuffix}`;
  if (io.inspect(target)) assertFile(io, target, { uid: 0, gid: 0, mode: 0o600,
    sha256: sha256(recordBytes(proof)) }, "AEGIS_SSH_REPAIR_AUTH_PROOF_INVALID");
  else io.createFileExclusive(target, recordBytes(proof), 0, 0, 0o600);
  if (!recorded) io.appendJournal(recoveryJournalPath, { record_type: "NORMAL_SSH_PROOF_RECORDED", phase: 2,
    recorded_at: proof.authenticatedAt, proof_sha256: canonicalSha256(proof), session: proof.session });
  return { status: "RECOVERY_AUTH_PROOF_RECORDED", proof_path: target,
    authority_consumed: true, scheduler_activated: false, workload_executed: false, network_accessed: false };
}
export function inspectSshSessionEvidence(value) {
  try { validateSshSessionEvidence(value); return true; } catch { return false; }
}

function settleFailedRecovery({ manifest, manifestBytes, authority, io, assetBytes, assetSourcePath,
  installerBytes, launcherBytes, standingKeyBinding, entrypointSha256, clock, challengeNonce,
  machineIdentitySha256 }) {
  const recoveryJournalPath = `${JOURNAL_PREFIX}${authority.authorityId}.recovery.journal.jsonl`;
  const recoveryProofPath = `${AUTH_PROOF_ROOT}/${authority.authorityId}${manifest.failedRecovery.normalSshProofSuffix}`;
  let recoveryRecords = recoveryJournalRecords(io, recoveryJournalPath, authority);
  const resume = recoveryRecords.length > 0;
  let consumed = resume;
  const initial = basePreflight({ manifest, manifestBytes, authority, assetBytes, assetSourcePath,
    installerBytes, launcherBytes, standingKeyBinding, entrypointSha256, io, now: clock(),
    machineIdentitySha256, resume, recovery: true });
  const failed = exactFailedJournal(io);
  const postMutation = authority.operation === "SETTLE_POST_MUTATION";
  assertFile(io, CONFIG_PATH, { uid: 0, gid: 0, mode: 0o444,
    sha256: postMutation ? manifest.reviewedConfig.sha256 : manifest.predecessor.sha256 },
    "AEGIS_SSH_REPAIR_RECOVERY_UNCERTAIN");
  if (postMutation) {
    assertDirectory(io, AUTHORIZED_KEYS_ROOT, { uid: 0, gid: 0, mode: 0o755 },
      "AEGIS_SSH_REPAIR_RECOVERY_UNCERTAIN");
    assertFile(io, STANDING_ROOT_KEY_PATH, { uid: 0, gid: 0, mode: 0o444,
      sha256: manifest.standingKey.recordSha256 }, "AEGIS_SSH_REPAIR_RECOVERY_UNCERTAIN");
  } else if (io.inspect(STANDING_ROOT_KEY_PATH) || io.inspect(AUTHORIZED_KEYS_ROOT))
    fail("AEGIS_SSH_REPAIR_RECOVERY_UNCERTAIN", "failed repair retained state");
  assertInactive(io, manifest, initial.account, Buffer.alloc(0), false);
  let reloadEvidence = null;
  if (postMutation) {
    const daemon = validateDaemonIdentity(io.sshDaemonIdentity());
    reloadEvidence = validateReloadEvidence(io.sshReloadEvidence(CONFIG_PATH, daemon), daemon);
    io.validateLiveSshd();
    verifyEffective(io);
  }
  if (failed.records.length === 3) {
    if (recoveryRecords.at(-1)?.record_type === "LOCK_RELEASE_PROVEN")
      fail("AEGIS_SSH_REPAIR_AUTHORITY_REPLAY", "recovery authority is terminal");
  }
  const lockBytes = recordBytes({ schema_version: "1.0-aegis-ssh-coexistence-repair-lock",
    authority_id: authority.authorityId, repair_id: manifest.repairId });
  const held = [];
  const release = (recordType) => {
    while (held.length) {
      const target = held.at(-1); io.releaseLock(target, lockBytes, 0, 0, 0o600); held.pop();
    }
    if (recordType) io.appendJournal(recoveryJournalPath, { record_type: recordType, phase: 3,
      released_at: clock(), reservation_locks: [...RESERVATION_LOCK_PATHS] });
  };
  try {
    for (const target of RESERVATION_LOCK_PATHS) { io.acquireLock(target, lockBytes, 0, 0, 0o600, true); held.push(target); }
    if (!resume) {
      if (io.inspect(recoveryProofPath))
        fail("AEGIS_SSH_REPAIR_AUTH_PROOF_PREPOSITIONED", "recovery authentication proof predates its challenge");
      validateRecoveryAuthority(authority, manifest, manifestBytes, clock(), false);
      io.createJournal(recoveryJournalPath, { schema_version: "1.0-aegis-ssh-failed-recovery-journal",
        record_type: "AUTHORITY_CONSUMED", phase: 0, authority_id: authority.authorityId,
        authority_sha256: canonicalSha256(authority), manifest_sha256: sha256(manifestBytes),
        failed_authority_id: FAILED_RECOVERY_AUTHORITY_ID, failed_authority_sha256: FAILED_RECOVERY_AUTHORITY_SHA256,
        failed_manifest_sha256: FAILED_RECOVERY_MANIFEST_SHA256, consumed_at: clock() });
      consumed = true;
    }
    let challenge = recoveryRecords.find((record) => record.record_type === "RECOVERY_CHALLENGE_ISSUED");
    if (!challenge) {
      const daemon = validateDaemonIdentity(io.sshDaemonIdentity());
      challenge = { record_type: "RECOVERY_CHALLENGE_ISSUED", phase: 1,
        challenge_nonce: challengeNonce(), challenge_issued_at: clock(), daemon_identity: daemon };
      if (!/^[a-f0-9]{64}$/.test(challenge.challenge_nonce)) fail("AEGIS_SSH_REPAIR_CHALLENGE_INVALID", "challenge nonce differs");
      io.appendJournal(recoveryJournalPath, challenge);
      release("LOCK_RELEASE_PROVEN_AWAITING_AUTH_PROBE");
      return { status: "AWAITING_RECOVERY_AUTH_PROBE", authority_consumed: true,
        auth_proof_path: recoveryProofPath, auth_challenge: challenge,
        scheduler_activated: false, workload_executed: false, network_accessed: false, journal_path: recoveryJournalPath };
    }
    let waitingRelease = recoveryRecords.find((record) => record.record_type === "LOCK_RELEASE_PROVEN_AWAITING_AUTH_PROBE");
    if (!waitingRelease) {
      if (io.inspect(recoveryProofPath))
        fail("AEGIS_SSH_REPAIR_AUTH_PROOF_PREPOSITIONED", "recovery authentication proof predates proven release");
      release("LOCK_RELEASE_PROVEN_AWAITING_AUTH_PROBE");
      return { status: "AWAITING_RECOVERY_AUTH_PROBE", authority_consumed: true,
        auth_proof_path: recoveryProofPath, auth_challenge: challenge,
        scheduler_activated: false, workload_executed: false, network_accessed: false, journal_path: recoveryJournalPath };
    }
    if (!challenge || !/^[a-f0-9]{64}$/.test(challenge.challenge_nonce ?? "") || !canonicalTimestamp(challenge.challenge_issued_at))
      fail("AEGIS_SSH_REPAIR_RECOVERY_JOURNAL_UNTRUSTED", "recovery challenge differs");
    const daemon = validateDaemonIdentity(io.sshDaemonIdentity());
    if (!same(daemon, challenge.daemon_identity)) fail("AEGIS_SSH_REPAIR_DAEMON_IDENTITY_DRIFT", "SSH daemon changed during recovery proof");
    const proof = io.recoveryAuthProof(recoveryProofPath);
    const produced = recoveryRecords.find((record) => record.record_type === "NORMAL_SSH_PROOF_RECORDED");
    const expectedProof = { schemaVersion: 2, operation: "NORMAL_SSH_AUTHENTICATED",
      producer: INSTALLED_INSTALLER_PATH, producerSha256: manifest.installer.sha256,
      recoveryAuthorityId: authority.authorityId, failedAuthorityId: FAILED_RECOVERY_AUTHORITY_ID,
      challengeNonce: challenge.challenge_nonce, challengeIssuedAt: challenge.challenge_issued_at,
      releaseProvenAt: waitingRelease.released_at, daemonIdentity: daemon,
      session: proof?.session, authenticatedAt: proof?.authenticatedAt };
    if (!proof || !produced || produced.proof_sha256 !== canonicalSha256(proof) || !same(produced.session, proof.session) ||
        produced.recorded_at !== proof.authenticatedAt || !canonicalTimestamp(proof.authenticatedAt) || Date.parse(proof.authenticatedAt) <= Date.parse(waitingRelease.released_at) ||
        Date.parse(proof.authenticatedAt) > Date.parse(clock()) || !same(proof, expectedProof))
      fail("AEGIS_SSH_REPAIR_AUTH_PROOF_INVALID", "normal SSH recovery proof differs");
    validateSshSessionEvidence(proof.session);
    validateRecoveryAuthority(authority, manifest, manifestBytes, clock(), true);
    if (failed.records.length === 1) {
      io.appendJournal(failed.target, { record_type: "FAILED_PARTIAL", phase: 3, failed_at: clock(),
        failure_code: postMutation ? "POST_MUTATION_SETTLED" : "ENOENT",
        predecessor_config_restored: !postMutation, standing_root_key_removed: !postMutation,
        authorized_keys_directory_removed: !postMutation, post_mutation_state_preserved: postMutation,
        daemon_identity_unchanged: true, reload_evidence: reloadEvidence,
        normal_ssh_proof_sha256: canonicalSha256(proof), lock_release_proven: false,
        scheduler_activated: false, workload_executed: false, network_accessed: false });
    }
    const alreadyCommitted = recoveryRecords.some((record) => record.record_type === "COMMITTED");
    release(null);
    const failedAfter = exactFailedJournal(io);
    if (failedAfter.records.length === 2)
      io.appendJournal(failed.target, { record_type: "FAILED_LOCK_RELEASE_PROVEN", phase: 4,
        released_at: clock(), reservation_locks: [...RESERVATION_LOCK_PATHS] });
    if (!alreadyCommitted)
      io.appendJournal(recoveryJournalPath, { record_type: "COMMITTED", phase: 2, committed_at: clock(),
        failed_authority_id: FAILED_RECOVERY_AUTHORITY_ID, failed_journal_terminal: "FAILED_LOCK_RELEASE_PROVEN",
        daemon_identity: daemon, normal_ssh_proof_sha256: canonicalSha256(proof),
        scheduler_activated: false, workload_executed: false, network_accessed: false });
    io.appendJournal(recoveryJournalPath, { record_type: "LOCK_RELEASE_PROVEN", phase: 3,
      released_at: clock(), reservation_locks: [...RESERVATION_LOCK_PATHS] });
    return { status: "FAILED_RECOVERY_SETTLED", authority_consumed: true,
      failed_authority_id: FAILED_RECOVERY_AUTHORITY_ID, recovery_authority_id: authority.authorityId,
      daemon_identity_unchanged: true, normal_ssh_proven: true, scheduler_activated: false,
      workload_executed: false, network_accessed: false, journal_path: recoveryJournalPath };
  } catch (error) {
    try { if (held.length) release(null); } catch {}
    Object.assign(error, { authorityConsumed: consumed, journalPath: recoveryJournalPath });
    throw error;
  }
}

export function repairAegisSshCoexistence({
  manifest,
  manifestBytes,
  authority,
  mode = "dry-run",
  io,
  assetBytes,
  assetSourcePath,
  installerBytes,
  launcherBytes,
  standingKeyBinding = LIVE_STANDING_KEY,
  entrypointSha256 = LIVE_ENTRYPOINT_SHA256,
  clock = () => new Date().toISOString(),
  challengeNonce = () => crypto.randomBytes(32).toString("hex"),
  machineIdentitySha256,
}) {
  if (["SETTLE_FAILED_RECOVERY", "SETTLE_POST_MUTATION"].includes(authority?.operation))
    return settleFailedRecovery({ manifest, manifestBytes, authority, io, assetBytes, assetSourcePath,
      installerBytes, launcherBytes, standingKeyBinding, entrypointSha256, clock, challengeNonce,
      machineIdentitySha256 });
  const journalPath = `${JOURNAL_PREFIX}${authority?.authorityId}.journal.jsonl`;
  const existing = journalRecords(io, journalPath);
  const resume = existing.length > 0;
  const initial = basePreflight({
    manifest,
    manifestBytes,
    authority,
    assetBytes,
    assetSourcePath,
    installerBytes,
    launcherBytes,
    standingKeyBinding,
    entrypointSha256,
    io,
    now: clock(),
    machineIdentitySha256,
    resume,
  });
  const first = existing[0];
  if (
    resume &&
    (!exactKeys(first, ["schema_version", "record_type", "phase", "authority_id", "authority_sha256", "manifest_sha256", "authorized_keys_directory_preexisted", "consumed_at"]) ||
      first.schema_version !== "1.0-aegis-ssh-coexistence-repair-journal" ||
      first.record_type !== "AUTHORITY_CONSUMED" || first.phase !== 0 || first.authority_id !== authority.authorityId ||
      first.authority_sha256 !== canonicalSha256(authority) ||
      first.manifest_sha256 !== sha256(manifestBytes) ||
      typeof first.authorized_keys_directory_preexisted !== "boolean" || !canonicalTimestamp(first.consumed_at))
  )
    fail(
      "AEGIS_SSH_REPAIR_JOURNAL_UNTRUSTED",
      "journal authority binding differs",
    );
  const keyRoot = io.inspect(AUTHORIZED_KEYS_ROOT);
  const exactDirectory = keyRoot?.type === "directory" && keyRoot.direct &&
    keyRoot.uid === 0 && keyRoot.gid === 0 && keyRoot.mode === 0o755;
  const exactTransactionPartialDirectory = resume &&
    first.authorized_keys_directory_preexisted === false && keyRoot?.type === "directory" &&
    keyRoot.direct && keyRoot.uid === 0 && keyRoot.gid === 0 && keyRoot.mode === 0o700;
  if (
    keyRoot &&
    !exactDirectory && !exactTransactionPartialDirectory
  )
    fail(
      "AEGIS_SSH_REPAIR_AUTHORIZED_KEYS_DIRECTORY_DRIFT",
      "authorized_keys directory differs",
    );
  if (mode === "dry-run") {
    if (resume)
      fail(
        "AEGIS_SSH_REPAIR_AUTHORITY_REPLAY",
        "dry-run authority was consumed",
      );
    assertFile(
      io,
      CONFIG_PATH,
      { uid: 0, gid: 0, mode: 0o444, sha256: manifest.predecessor.sha256 },
      "AEGIS_SSH_REPAIR_PREDECESSOR_DRIFT",
    );
    assertInactive(io, manifest, initial.account, Buffer.alloc(0), false);
    if (io.inspect(STANDING_ROOT_KEY_PATH))
      fail(
        "AEGIS_SSH_REPAIR_INACTIVE_STATE_REQUIRED",
        "standing root key must be absent",
      );
    return {
      status: "DRY_RUN",
      authority_consumed: false,
      mutations: [],
      scheduler_activated: false,
      workload_executed: false,
      network_accessed: false,
    };
  }
  const directoryPreexisted = resume
    ? first.authorized_keys_directory_preexisted
    : Boolean(keyRoot);
  const terminal = existing.at(-1)?.record_type;
  if (["LOCK_RELEASE_PROVEN", "FAILED_LOCK_RELEASE_PROVEN"].includes(terminal))
    fail("AEGIS_SSH_REPAIR_AUTHORITY_REPLAY", "authority is terminal");
  const lockBytes = recordBytes({
    schema_version: "1.0-aegis-ssh-coexistence-repair-lock",
    authority_id: authority.authorityId,
    repair_id: manifest.repairId,
  });
  const held = [];
  let journalCreated = resume;
  let committed = existing.some((r) => r.record_type === "COMMITTED");
  let mutated = existing.some((r) =>
    [
      "MUTATED_AWAITING_AUTH_PROBE",
      "AUTH_PROBE_CHALLENGE_ISSUED",
      "LOCK_RELEASE_PROVEN_AWAITING_AUTH_PROBE",
      "COMMITTED",
    ].includes(r.record_type),
  );
  let challenge =
    existing.find((r) => r.record_type === "AUTH_PROBE_CHALLENGE_ISSUED") ??
    null;
  let completed = mutated ? [...manifest.mutations] : [];
  const acquire = () => {
    for (const target of RESERVATION_LOCK_PATHS) {
      io.acquireLock(target, lockBytes, 0, 0, 0o600, true);
      held.push(target);
    }
  };
  const release = (recordType = null) => {
    while (held.length) {
      const target = held.at(-1);
      io.releaseLock(target, lockBytes, 0, 0, 0o600);
      held.pop();
    }
    if (recordType)
      io.appendJournal(journalPath, {
        record_type: recordType,
        phase: 4,
        released_at: clock(),
        reservation_locks: [...RESERVATION_LOCK_PATHS],
      });
  };
  try {
    acquire();
    if (!journalCreated) {
      if (io.inspect(`${AUTH_PROOF_ROOT}/${authority.authorityId}.json`))
        fail(
          "AEGIS_SSH_REPAIR_AUTH_PROOF_PREPOSITIONED",
          "authentication proof predates its challenge",
        );
      assertFile(
        io,
        CONFIG_PATH,
        { uid: 0, gid: 0, mode: 0o444, sha256: manifest.predecessor.sha256 },
        "AEGIS_SSH_REPAIR_PREDECESSOR_DRIFT",
      );
      if (io.inspect(STANDING_ROOT_KEY_PATH))
        fail(
          "AEGIS_SSH_REPAIR_INACTIVE_STATE_REQUIRED",
          "standing root key must be absent",
        );
      assertInactive(io, manifest, initial.account, lockBytes, true);
      io.createJournal(journalPath, {
        schema_version: "1.0-aegis-ssh-coexistence-repair-journal",
        record_type: "AUTHORITY_CONSUMED",
        phase: 0,
        authority_id: authority.authorityId,
        authority_sha256: canonicalSha256(authority),
        manifest_sha256: sha256(manifestBytes),
        authorized_keys_directory_preexisted: Boolean(keyRoot),
        consumed_at: clock(),
      });
      journalCreated = true;
    }
    if (existing.some((record) => record.record_type === "FAILED_PARTIAL")) {
      assertFile(
        io,
        CONFIG_PATH,
        { uid: 0, gid: 0, mode: 0o444, sha256: manifest.predecessor.sha256 },
        "AEGIS_SSH_REPAIR_RECOVERY_UNCERTAIN",
      );
      if (io.inspect(STANDING_ROOT_KEY_PATH))
        fail(
          "AEGIS_SSH_REPAIR_RECOVERY_UNCERTAIN",
          "failed repair retained standing root key",
        );
      assertInactive(io, manifest, initial.account, lockBytes, true);
      release("FAILED_LOCK_RELEASE_PROVEN");
      fail("AEGIS_SSH_REPAIR_AUTHORITY_REPLAY", "failed authority is terminal");
    }
    if (committed) {
      exactPost(io, manifest);
      assertInactive(io, manifest, initial.account, lockBytes, true);
      release("LOCK_RELEASE_PROVEN");
      return {
        status: "COMMITTED",
        authority_consumed: true,
        recovered: true,
        mutations: [...manifest.mutations],
        scheduler_activated: false,
        workload_executed: false,
        network_accessed: false,
        journal_path: journalPath,
      };
    }
    if (!mutated) {
      io.ensureDirectoryExact(AUTHORIZED_KEYS_ROOT, 0, 0, 0o755,
        resume && directoryPreexisted === false);
      const config = io.inspect(CONFIG_PATH)
        ? sha256(io.read(CONFIG_PATH))
        : null;
      const key = io.inspect(STANDING_ROOT_KEY_PATH)
        ? sha256(io.read(STANDING_ROOT_KEY_PATH))
        : null;
      if (config === manifest.predecessor.sha256 && key === null) {
        io.createFileExclusive(
          STANDING_ROOT_KEY_PATH,
          initial.standingBytes,
          0,
          0,
          0o444,
        );
        io.atomicReplace(CONFIG_PATH, assetBytes, 0, 0, 0o444);
      } else if (
        config === manifest.predecessor.sha256 &&
        key === manifest.standingKey.recordSha256
      ) {
        io.atomicReplace(CONFIG_PATH, assetBytes, 0, 0, 0o444);
      } else if (
        !(
          config === manifest.reviewedConfig.sha256 &&
          key === manifest.standingKey.recordSha256
        )
      )
        fail(
          "AEGIS_SSH_REPAIR_RECOVERY_UNCERTAIN",
          "partial state cannot be resumed exactly",
        );
      completed = [...manifest.mutations];
      exactPost(io, manifest);
      assertInactive(io, manifest, initial.account, lockBytes, true);
      io.validateLiveSshd();
      io.reloadSshd();
      io.validateLiveSshd();
      verifyEffective(io);
      assertInactive(io, manifest, initial.account, lockBytes, true);
      io.appendJournal(journalPath, {
        record_type: "MUTATED_AWAITING_AUTH_PROBE",
        phase: 2,
        mutated_at: clock(),
        completed_mutations: completed,
      });
      mutated = true;
    }
    if (!challenge) {
      challenge = {
        record_type: "AUTH_PROBE_CHALLENGE_ISSUED",
        phase: 2,
        challenge_nonce: challengeNonce(),
        challenge_issued_at: clock(),
      };
      if (!/^[a-f0-9]{64}$/.test(challenge.challenge_nonce))
        fail("AEGIS_SSH_REPAIR_CHALLENGE_INVALID", "challenge nonce differs");
      io.appendJournal(journalPath, challenge);
    }
    exactPost(io, manifest);
    assertInactive(io, manifest, initial.account, lockBytes, true);
    const proofNow = clock();
    const auth = proof(io, manifest, authority, challenge, proofNow);
    if (!auth) {
      release("LOCK_RELEASE_PROVEN_AWAITING_AUTH_PROBE");
      return {
        status: "AWAITING_AUTH_PROBE",
        authority_consumed: true,
        mutations: completed,
        auth_proof_path: `${AUTH_PROOF_ROOT}/${authority.authorityId}.json`,
        auth_challenge: {
          nonce: challenge.challenge_nonce,
          issued_at: challenge.challenge_issued_at,
        },
        scheduler_activated: false,
        workload_executed: false,
        network_accessed: false,
        journal_path: journalPath,
      };
    }
    io.validateLiveSshd();
    verifyEffective(io);
    assertInactive(io, manifest, initial.account, lockBytes, true);
    io.appendJournal(journalPath, {
      record_type: "COMMITTED",
      phase: 3,
      committed_at: clock(),
      completed_mutations: completed,
      auth_proof_sha256: canonicalSha256(auth),
      scheduler_activated: false,
      workload_executed: false,
      network_accessed: false,
    });
    committed = true;
    release("LOCK_RELEASE_PROVEN");
    return {
      status: "COMMITTED",
      authority_consumed: true,
      mutations: completed,
      scheduler_activated: false,
      workload_executed: false,
      network_accessed: false,
      journal_path: journalPath,
    };
  } catch (error) {
    if (committed) {
      Object.assign(error, { authorityConsumed: true, journalPath });
      throw error;
    }
    const recoveryErrors = [];
    let failureRecorded = false;
    if (journalCreated && held.length === RESERVATION_LOCK_PATHS.length) {
      try {
        const config = io.inspect(CONFIG_PATH)
          ? sha256(io.read(CONFIG_PATH))
          : null;
        if (config === manifest.reviewedConfig.sha256)
          io.restoreConfigExact(
            CONFIG_PATH,
            initial.predecessorBytes,
            manifest.predecessor.sha256,
            manifest.reviewedConfig.sha256,
            0,
            0,
            0o444,
          );
        else if (config !== manifest.predecessor.sha256)
          fail("AEGIS_SSH_REPAIR_ROLLBACK_DRIFT", "config differs");
        io.removeExactOrAbsent(
          STANDING_ROOT_KEY_PATH,
          manifest.standingKey.recordSha256,
          0,
          0,
          0o444,
        );
        if (directoryPreexisted === false)
          io.removeDirectoryExactEmpty(AUTHORIZED_KEYS_ROOT, 0, 0, 0o755);
        assertInactive(io, manifest, initial.account, lockBytes, true);
        io.appendJournal(journalPath, {
          record_type: "FAILED_PARTIAL",
          phase: 3,
          failed_at: clock(),
          failure_code: error?.code ?? "AEGIS_SSH_REPAIR_APPLY_FAILED",
          predecessor_config_restored: true,
          standing_root_key_removed: true,
          authorized_keys_directory_removed: directoryPreexisted === false,
          lock_release_proven: false,
          scheduler_activated: false,
          workload_executed: false,
          network_accessed: false,
        });
        failureRecorded = true;
      } catch (recoveryError) {
        recoveryErrors.push(recoveryError);
      }
    }
    try {
      if (held.length)
        release(failureRecorded ? "FAILED_LOCK_RELEASE_PROVEN" : null);
    } catch (releaseError) {
      recoveryErrors.push(releaseError);
    }
    if (recoveryErrors.length)
      fail(
        "AEGIS_SSH_REPAIR_RECOVERY_UNCERTAIN",
        "rollback or lock release is uncertain",
        {
          causeCode: recoveryErrors[0]?.code ?? null,
          originalFailureCode: error?.code ?? null,
          authorityConsumed: journalCreated,
          journalPath,
        },
      );
    Object.assign(error, { authorityConsumed: journalCreated, journalPath });
    throw error;
  }
}

function trustedParents(target) {
  const serviceParents = new Map(
    TRUSTED_SERVICE_PARENTS.map((entry) => [entry.path, entry]),
  );
  let current = path.posix.dirname(target);
  while (true) {
    const stat = fs.lstatSync(current),
      service = serviceParents.get(current);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      fs.realpathSync(current) !== current
    )
      return false;
    if (service) {
      if (
        stat.uid !== service.uid ||
        stat.gid !== service.gid ||
        (stat.mode & 0o7777) !== Number.parseInt(service.mode, 8)
      )
        return false;
    } else if (stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o022) !== 0)
      return false;
    if (current === "/") return true;
    current = path.posix.dirname(current);
  }
}
function trustedKernelLockParent() {
  try {
    const run = fs.lstatSync("/run"),
      lock = fs.lstatSync("/run/lock");
    return (
      run.isDirectory() &&
      !run.isSymbolicLink() &&
      fs.realpathSync("/run") === "/run" &&
      run.uid === 0 &&
      run.gid === 0 &&
      (run.mode & 0o7777) === 0o755 &&
      lock.isDirectory() &&
      !lock.isSymbolicLink() &&
      fs.realpathSync("/run/lock") === "/run/lock" &&
      lock.uid === 0 &&
      lock.gid === 0 &&
      (lock.mode & 0o7777) === 0o1777
    );
  } catch {
    return false;
  }
}
function trustedParentFor(target) {
  return target === LOCK_PATH
    ? trustedKernelLockParent()
    : trustedParents(target);
}
function linuxDeviceParts(device) {
  return {
    major: ((device >> 8n) & 0xfffn) | ((device >> 32n) & ~0xfffn),
    minor: (device & 0xffn) | ((device >> 12n) & ~0xffn),
  };
}
function inheritedFlockExact(fd, target) {
  const stat = fs.fstatSync(fd, { bigint: true }),
    device = linuxDeviceParts(stat.dev),
    lines = fs.readFileSync("/proc/locks", "utf8").split("\n").filter(Boolean);
  const matches = lines.filter((line) => {
    const match = line.match(
      /^\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+(\d+)\s+([0-9a-f]+):([0-9a-f]+):(\d+)\s+0\s+EOF$/i,
    );
    return (
      match &&
      Number(match[1]) === process.pid &&
      BigInt(`0x${match[2]}`) === device.major &&
      BigInt(`0x${match[3]}`) === device.minor &&
      BigInt(match[4]) === stat.ino
    );
  });
  return (
    fs.realpathSync(`/proc/self/fd/${fd}`) === target && matches.length === 1
  );
}
function stableStatEqual(value, baseline, expected) {
  return (
    value.isFile() &&
    !value.isSymbolicLink() &&
    value.nlink === 1n &&
    value.dev === baseline.dev &&
    value.ino === baseline.ino &&
    value.size === baseline.size &&
    value.mtimeNs === baseline.mtimeNs &&
    value.ctimeNs === baseline.ctimeNs &&
    value.uid === BigInt(expected.uid) &&
    value.gid === BigInt(expected.gid) &&
    (value.mode & 0o7777n) === BigInt(expected.mode)
  );
}
function ipv4FromProcHex(value) {
  if (!/^[A-F0-9]{8}$/.test(value)) return null;
  return [6, 4, 2, 0].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16)).join(".");
}
function sshdSessionSocket(pid) {
  const inodes = new Set(fs.readdirSync(`/proc/${pid}/fd`).flatMap((name) => {
    try {
      const match = fs.readlinkSync(`/proc/${pid}/fd/${name}`).match(/^socket:\[(\d+)\]$/);
      return match ? [match[1]] : [];
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }));
  const matches = fs.readFileSync("/proc/net/tcp", "utf8").split("\n").slice(1).flatMap((line) => {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10 || fields[3] !== "01" || !inodes.has(fields[9])) return [];
    const [localHex, localPortHex] = fields[1].split(":"), [remoteHex, remotePortHex] = fields[2].split(":");
    if (localPortHex !== "0016") return [];
    return [{ sourceAddress: ipv4FromProcHex(remoteHex), sourcePort: Number.parseInt(remotePortHex, 16),
      targetAddress: ipv4FromProcHex(localHex), targetPort: 22, socketInode: fields[9] }];
  });
  if (matches.length !== 1 || !matches[0].sourceAddress || !matches[0].targetAddress)
    fail("AEGIS_SSH_REPAIR_AUTH_PROOF_INVALID", "sshd session socket evidence differs");
  return matches[0];
}
function fsyncParent(target) {
  const fd = fs.openSync(path.posix.dirname(target), fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function writeExact(target, bytes, uid, gid, mode, exclusive) {
  if (!trustedParentFor(target))
    fail("AEGIS_SSH_REPAIR_PARENT_UNTRUSTED", `${target} parent differs`);
  const temporary = exclusive ? target : `${target}.${crypto.randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(
      temporary,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW ?? 0),
      mode,
    );
    fs.fchmodSync(fd, mode);
    fs.fchownSync(fd, uid, gid);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    if (!exclusive) fs.renameSync(temporary, target);
    fsyncParent(target);
  } catch (error) {
    if (fd != null)
      try {
        fs.closeSync(fd);
      } catch {}
    if (!exclusive)
      try {
        fs.unlinkSync(temporary);
      } catch {}
    throw error;
  }
}
function fixedRun(command, args, accepted = [0]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    timeout: 30_000,
    maxBuffer: MAX_BYTES,
    env: {
      PATH: "/usr/sbin:/usr/bin:/sbin:/bin",
      HOME: "/root",
      LANG: "C",
      LC_ALL: "C",
    },
  });
  if (result.error || result.signal || !accepted.includes(result.status))
    fail(
      "AEGIS_SSH_REPAIR_COMMAND_FAILED",
      `${command} ${args[0] ?? ""} failed`,
    );
  return result.stdout ?? "";
}
export function createNodeRepairIo() {
  const inspect = (target) => {
    try {
      const s = fs.lstatSync(target);
      return {
        type: s.isFile() ? "file" : s.isDirectory() ? "directory" : "other",
        direct: fs.realpathSync(target) === target,
        nlink: s.nlink,
        uid: s.uid,
        gid: s.gid,
        mode: s.mode & 0o7777,
      };
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  };
  const read = (target) => {
    const fd = fs.openSync(
      target,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES)
        fail("AEGIS_SSH_REPAIR_FILE_UNTRUSTED", `${target} differs`);
      return fs.readFileSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  };
  const appendJournal = (target, record) => {
    const observed = inspect(target);
    if (
      !observed ||
      observed.uid !== 0 ||
      observed.gid !== 0 ||
      observed.mode !== 0o600
    )
      fail("AEGIS_SSH_REPAIR_JOURNAL_UNTRUSTED", "journal metadata differs");
    const fd = fs.openSync(
      target,
      fs.constants.O_WRONLY |
        fs.constants.O_APPEND |
        (fs.constants.O_NOFOLLOW ?? 0),
    );
    try {
      fs.writeFileSync(fd, recordBytes(record));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fsyncParent(target);
  };
  return {
    platform: () => process.platform,
    euid: () => process.getuid?.(),
    hostname: () => os.hostname(),
    inspect,
    read,
    parentsTrusted: trustedParentFor,
    kernelLockHeld() {
      try {
        if (!trustedKernelLockParent()) return false;
        const descriptors = fs
          .readdirSync("/proc/self/fd")
          .filter((name) => /^\d+$/.test(name))
          .map(Number)
          .filter((fd) => {
            try {
              const stat = fs.fstatSync(fd);
              return (
                stat.isFile() &&
                stat.nlink === 1 &&
                stat.uid === 0 &&
                stat.gid === 0 &&
                (stat.mode & 0o7777) === 0o600 &&
                inheritedFlockExact(fd, KERNEL_LOCK_PATH)
              );
            } catch {
              return false;
            }
          });
        return descriptors.length === 1;
      } catch {
        return false;
      }
    },
    readStable(
      target,
      expected,
      code = "AEGIS_SSH_REPAIR_AUTHORITY_FILE_UNTRUSTED",
    ) {
      if (!trustedParentFor(target))
        fail(code, `${target} parent chain differs`);
      const before = fs.lstatSync(target, { bigint: true });
      let fd;
      try {
        fd = fs.openSync(
          target,
          fs.constants.O_RDONLY |
            (fs.constants.O_NOFOLLOW ?? 0) |
            (fs.constants.O_CLOEXEC ?? 0),
        );
        const openedBefore = fs.fstatSync(fd, { bigint: true });
        if (
          !stableStatEqual(openedBefore, before, expected) ||
          openedBefore.size > BigInt(MAX_BYTES)
        )
          fail(code, `${target} changed during read`);
        const bytes = fs.readFileSync(fd),
          openedAfter = fs.fstatSync(fd, { bigint: true }),
          after = fs.lstatSync(target, { bigint: true });
        if (
          !stableStatEqual(openedAfter, before, expected) ||
          !stableStatEqual(after, before, expected)
        )
          fail(code, `${target} changed during read`);
        return bytes;
      } finally {
        if (fd != null) fs.closeSync(fd);
      }
    },
    account(name) {
      const p = fixedRun("/usr/bin/getent", ["passwd", name]).trim().split(":");
      const g = fixedRun("/usr/bin/getent", ["group", name]).trim().split(":");
      return { uid: Number(p[2]), gid: Number(g[2]), home: p[5], shell: p[6] };
    },
    remoteDevInactive(inactivity, account) {
      try {
        for (const service of inactivity.services) {
          const r = spawnSync("/usr/bin/systemctl", ["is-active", service], {
            encoding: "utf8",
            timeout: 5000,
          });
          if (r.error || ![3, 4].includes(r.status)) return false;
        }
        const ticket = inspect(inactivity.ticketDirectory);
        return (
          !ticket ||
          (ticket.type === "directory" &&
            ticket.direct &&
            ticket.uid === 0 &&
            ticket.gid === account.gid &&
            ticket.mode === 0o3770 &&
            fs
              .readdirSync(inactivity.ticketDirectory)
              .every((name) => /^[0-9a-f-]{36}\.consumed$/i.test(name)))
        );
      } catch {
        return false;
      }
    },
    workerUnitsInactive(pattern) {
      try {
        const units = fixedRun("/usr/bin/systemctl", [
          "list-units",
          "--all",
          "--plain",
          "--no-legend",
          "--type=service",
          "--no-pager",
        ]);
        const matcher = new RegExp(pattern);
        return units
          .split("\n")
          .filter(Boolean)
          .every((line) => !matcher.test(line.trim().split(/\s+/, 1)[0]));
      } catch {
        return false;
      }
    },
    validateStagedSshd(asset) {
      fixedRun("/usr/sbin/sshd", ["-t", "-f", path.resolve(asset)]);
    },
    validateLiveSshd() {
      fixedRun("/usr/sbin/sshd", ["-t"]);
    },
    reloadSshd() {
      fixedRun("/usr/bin/systemctl", ["reload", "ssh"]);
    },
    effectiveSshd(address) {
      return fixedRun("/usr/sbin/sshd", [
        "-T",
        "-C",
        `user=williamos-fabric,host=aegis,addr=${address}`,
      ]);
    },
    standingAuthProof(target) {
      if (!inspect(target)) return null;
      const bytes = this.readStable(
        target,
        { uid: 0, gid: 0, mode: 0o600 },
        "AEGIS_SSH_REPAIR_AUTH_PROOF_INVALID",
      );
      const value = parseJson(
        bytes,
        "AEGIS_SSH_REPAIR_AUTH_PROOF_INVALID",
        "auth proof",
      );
      if (!bytes.equals(recordBytes(value)))
        fail(
          "AEGIS_SSH_REPAIR_AUTH_PROOF_INVALID",
          "auth proof is not canonical",
        );
      return value;
    },
    sshDaemonIdentity() {
      const active = fixedRun("/usr/bin/systemctl", ["is-active", "ssh"]).trim();
      const mainPid = Number(fixedRun("/usr/bin/systemctl", ["show", "ssh", "--property=MainPID", "--value"]).trim());
      const startTimestampMonotonic = fixedRun("/usr/bin/systemctl", ["show", "ssh", "--property=ExecMainStartTimestampMonotonic", "--value"]).trim();
      if (active !== "active") fail("AEGIS_SSH_REPAIR_DAEMON_IDENTITY_DRIFT", "SSH daemon is not active");
      return { mainPid, startTimestampMonotonic };
    },
    sshReloadEvidence(target, daemon) {
      const config = fs.lstatSync(target, { bigint: true });
      const configCtime = new Date(Number(config.ctimeNs / 1000000n)).toISOString();
      const since = `@${Math.floor(Number(config.ctimeNs / 1000000n) / 1000)}`;
      const output = fixedRun("/usr/bin/journalctl", [`_PID=${daemon.mainPid}`, "--since", since,
        "-o", "json", "--no-pager"]);
      const events = output.split("\n").filter(Boolean).map((line) => JSON.parse(line));
      const timestamp = (event) => new Date(Number(event.__REALTIME_TIMESTAMP) / 1000).toISOString();
      const after = events.filter((event) => String(event._PID) === String(daemon.mainPid) &&
        Number(event.__REALTIME_TIMESTAMP) / 1000 >= Date.parse(configCtime));
      const reload = after.find((event) => event.MESSAGE === "Received SIGHUP; restarting.");
      const ipv4 = reload && after.find((event) => event.MESSAGE === "Server listening on 0.0.0.0 port 22." &&
        Number(event.__REALTIME_TIMESTAMP) >= Number(reload.__REALTIME_TIMESTAMP));
      const ipv6 = reload && after.find((event) => event.MESSAGE === "Server listening on :: port 22." &&
        Number(event.__REALTIME_TIMESTAMP) >= Number(reload.__REALTIME_TIMESTAMP));
      if (!reload || !ipv4 || !ipv6)
        fail("AEGIS_SSH_REPAIR_RELOAD_EVIDENCE_INVALID", "reviewed config reload was not proven");
      return { daemonIdentity: daemon, configCtime, reloadAt: timestamp(reload),
        ipv4ListeningAt: timestamp(ipv4), ipv6ListeningAt: timestamp(ipv6) };
    },
    sshSessionEvidence() {
      const fields = String(process.env.SSH_CONNECTION ?? "").trim().split(/\s+/);
      if (fields.length !== 4) fail("AEGIS_SSH_REPAIR_AUTH_PROOF_INVALID", "SSH connection evidence absent");
      const loginUid = Number(fs.readFileSync("/proc/self/loginuid", "utf8").trim());
      const auditSessionId = Number(fs.readFileSync("/proc/self/sessionid", "utf8").trim());
      let current = process.ppid, ancestor = null;
      for (let depth = 0; depth < 12 && current > 1; depth += 1) {
        const status = fs.readFileSync(`/proc/${current}/status`, "utf8");
        const cmdline = fs.readFileSync(`/proc/${current}/cmdline`);
        const stat = fs.readFileSync(`/proc/${current}/stat`, "utf8").trim();
        const command = cmdline.toString("utf8").split("\0").filter(Boolean);
        let executable = null;
        try { executable = fs.realpathSync(`/proc/${current}/exe`); }
        catch (error) { if (error?.code !== "ENOENT") throw error; }
        if (executable === "/usr/sbin/sshd" && command.length === 1 &&
            /^sshd: [A-Za-z0-9._-]+@notty$/.test(command[0])) {
          const end = stat.lastIndexOf(")"), tail = stat.slice(end + 2).split(" ");
          ancestor = { sshdAncestorPid: current, sshdAncestorStartTimeTicks: tail[19],
            sshdAncestorCmdlineSha256: sha256(cmdline) };
          break;
        }
        const parent = status.match(/^PPid:\s+(\d+)$/m);
        if (!parent) break;
        current = Number(parent[1]);
      }
      if (!ancestor) fail("AEGIS_SSH_REPAIR_AUTH_PROOF_INVALID", "sshd process ancestry absent");
      const socket = sshdSessionSocket(ancestor.sshdAncestorPid);
      if (socket.sourceAddress !== fields[0] || socket.sourcePort !== Number(fields[1]) ||
          socket.targetAddress !== fields[2] || socket.targetPort !== Number(fields[3]))
        fail("AEGIS_SSH_REPAIR_AUTH_PROOF_INVALID", "SSH environment and server socket differ");
      return { ...socket, loginUid, auditSessionId, ...ancestor };
    },
    recoveryAuthProof(target) {
      if (!inspect(target)) return null;
      const bytes = this.readStable(target, { uid: 0, gid: 0, mode: 0o600 }, "AEGIS_SSH_REPAIR_AUTH_PROOF_INVALID");
      const value = parseJson(bytes, "AEGIS_SSH_REPAIR_AUTH_PROOF_INVALID", "recovery auth proof");
      if (!bytes.equals(recordBytes(value))) fail("AEGIS_SSH_REPAIR_AUTH_PROOF_INVALID", "recovery auth proof is not canonical");
      return value;
    },
    acquireLock(target, bytes, uid, gid, mode, resume) {
      if (resume && inspect(target)) {
        assertFile(
          this,
          target,
          { uid, gid, mode, sha256: sha256(bytes) },
          "AEGIS_SSH_REPAIR_LOCK_DRIFT",
        );
        return;
      }
      writeExact(target, bytes, uid, gid, mode, true);
    },
    releaseLock(target, bytes, uid, gid, mode) {
      assertFile(
        this,
        target,
        { uid, gid, mode, sha256: sha256(bytes) },
        "AEGIS_SSH_REPAIR_LOCK_DRIFT",
      );
      fs.unlinkSync(target);
      fsyncParent(target);
    },
    createJournal(target, record) {
      writeExact(target, recordBytes(record), 0, 0, 0o600, true);
    },
    appendJournal,
    ensureDirectoryExact(target, uid, gid, mode, resumeOwnedPartial = false) {
      const current = inspect(target);
      if (current) {
        if (resumeOwnedPartial && current.type === "directory" && current.direct &&
            current.uid === uid && current.gid === gid && current.mode === 0o700) {
          fs.chmodSync(target, mode);
          fsyncParent(target);
          return true;
        }
        if (current.type !== "directory" || !current.direct || current.uid !== uid || current.gid !== gid || current.mode !== mode)
          fail("AEGIS_SSH_REPAIR_AUTHORIZED_KEYS_DIRECTORY_DRIFT", "authorized_keys directory differs");
        return false;
      }
      if (!trustedParents(target)) fail("AEGIS_SSH_REPAIR_PARENT_UNTRUSTED", `${target} parent differs`);
      fs.mkdirSync(target, { mode });
      fs.chownSync(target, uid, gid);
      fs.chmodSync(target, mode);
      fsyncParent(target);
      return true;
    },
    removeDirectoryExactEmpty(target, uid, gid, mode) {
      const current = inspect(target);
      if (!current) return;
      if (current.type !== "directory" || !current.direct || current.uid !== uid || current.gid !== gid || current.mode !== mode || fs.readdirSync(target).length !== 0)
        fail("AEGIS_SSH_REPAIR_ROLLBACK_DRIFT", "authorized_keys directory differs");
      fs.rmdirSync(target);
      fsyncParent(target);
    },
    createFileExclusive(target, bytes, uid, gid, mode) {
      writeExact(target, bytes, uid, gid, mode, true);
    },
    atomicReplace(target, bytes, uid, gid, mode) {
      writeExact(target, bytes, uid, gid, mode, false);
    },
    restoreConfigExact(target, bytes, predecessor, reviewed, uid, gid, mode) {
      const current = sha256(read(target));
      if (current === predecessor) return;
      if (current !== reviewed)
        fail("AEGIS_SSH_REPAIR_ROLLBACK_DRIFT", "foreign config");
      writeExact(target, bytes, uid, gid, mode, false);
    },
    removeExactOrAbsent(target, digest) {
      if (!inspect(target)) return;
      if (sha256(read(target)) !== digest)
        fail("AEGIS_SSH_REPAIR_ROLLBACK_DRIFT", "foreign key");
      fs.unlinkSync(target);
      fsyncParent(target);
    },
  };
}
export function sshCoexistenceRepairErrorEvidence(error) {
  return {
    status: "FAILED_CLOSED",
    code: error?.code ?? "AEGIS_SSH_REPAIR_FAILED",
    detail: String(error?.message ?? error),
    authority_consumed: error?.authorityConsumed ?? false,
    journal_path: error?.journalPath ?? null,
    cause_code: error?.causeCode ?? null,
    original_failure_code: error?.originalFailureCode ?? null,
    scheduler_activated: false,
    workload_executed: false,
    network_accessed: false,
  };
}
function parseCli(argv) {
  if (
    argv.length !== 3 ||
    !["--dry-run", "--apply", "--record-recovery-proof"].includes(argv[0]) ||
    argv[1] !== "--authority"
  )
    fail("AEGIS_SSH_REPAIR_ARGUMENT_INVALID", "expected mode and authority");
  const authorityPath = argv[2];
  if (
    !path.posix.isAbsolute(authorityPath) ||
    path.posix.dirname(authorityPath) !== AUTHORITY_ROOT ||
    !authorityPath.endsWith(".json") ||
    !UUID.test(path.posix.basename(authorityPath, ".json"))
  )
    fail("AEGIS_SSH_REPAIR_AUTHORITY_PATH_INVALID", "authority path differs");
  return { mode: argv[0] === "--apply" ? "apply" : argv[0] === "--record-recovery-proof" ? "record-recovery-proof" : "dry-run", authorityPath };
}
export function main(
  argv = process.argv.slice(2),
  {
    io = createNodeRepairIo(),
    stdout = process.stdout,
    stderr = process.stderr,
    repoRoot = process.env.WILLIAMOS_SSH_REPAIR_BUNDLE_ROOT,
    launcherPath = process.env.WILLIAMOS_SSH_REPAIR_LAUNCHER_PATH,
    clock = () => new Date().toISOString(),
    machineIdentitySha256,
  } = {},
) {
  try {
    const parsed = parseCli(argv);
    if (
      !repoRoot ||
      !launcherPath ||
      path.resolve(process.argv[1] ?? "") !== INSTALLED_INSTALLER_PATH
    )
      fail(
        "AEGIS_SSH_REPAIR_LAUNCHER_REQUIRED",
        "pinned root launcher required",
      );
    const authorityBytes = io.readStable(parsed.authorityPath, {
      uid: 0,
      gid: 0,
      mode: 0o600,
    });
    const authority = parseJson(
      authorityBytes,
      "AEGIS_SSH_REPAIR_AUTHORITY_INVALID",
      "authority",
    );
    if (
      path.posix.basename(parsed.authorityPath) !==
      `${authority.authorityId}.json`
    )
      fail(
        "AEGIS_SSH_REPAIR_AUTHORITY_PATH_INVALID",
        "authority filename differs",
      );
    const manifestBytes = fs.readFileSync(path.join(repoRoot, MANIFEST_PATH)),
      manifest = parseJson(
        manifestBytes,
        "AEGIS_SSH_REPAIR_MANIFEST_INVALID",
        "manifest",
      ),
      assetSourcePath = path.join(repoRoot, REVIEWED_CONFIG_ASSET),
      assetBytes = fs.readFileSync(assetSourcePath),
      installerBytes = fs.readFileSync(INSTALLED_INSTALLER_PATH),
      expectedLauncherPath = path.join(repoRoot, LAUNCHER_PATH);
    if (
      path.resolve(repoRoot) !==
        "/usr/local/share/williamos/aegis-ssh-coexistence-repair-bundle" ||
      path.resolve(launcherPath) !== expectedLauncherPath ||
      manifest.launcher?.executedPath !== expectedLauncherPath
    )
      fail("AEGIS_SSH_REPAIR_LAUNCHER_REQUIRED", "launcher path differs");
    const launcherBytes = assertFile(
      io,
      launcherPath,
      { uid: 0, gid: 0, mode: 0o555, sha256: manifest.launcher.sha256 },
      "AEGIS_SSH_REPAIR_LAUNCHER_UNTRUSTED",
    );
    const operation = parsed.mode === "record-recovery-proof" ? recordRecoverySshProof : repairAegisSshCoexistence;
    const result = operation({
      manifest,
      manifestBytes,
      authority,
      ...(parsed.mode === "record-recovery-proof" ? {} : { mode: parsed.mode }),
      io,
      assetBytes,
      assetSourcePath,
      installerBytes,
      launcherBytes,
      clock,
      machineIdentitySha256:
        machineIdentitySha256 ??
        sha256(Buffer.from(fs.readFileSync("/etc/machine-id", "utf8").trim())),
    });
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    stderr.write(
      `${JSON.stringify(sshCoexistenceRepairErrorEvidence(error), null, 2)}\n`,
    );
    return 2;
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = main();
