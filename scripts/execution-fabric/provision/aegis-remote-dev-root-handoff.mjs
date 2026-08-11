import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const MANIFEST_PATH = "config/execution-fabric/aegis-remote-dev-root-handoff.json"
const SHA256 = /^[a-f0-9]{64}$/
const SHA40 = /^[a-f0-9]{40}$/
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PLACEHOLDER = /owner-approved|published|placeholder|example|todo/i
const EXPECTED_COMMIT = "bcca6069a917d706314f7c8cb7b3cd40cdd910da"
const EXPECTED_PACKAGE_JCS = "cf39e367f9f5437d43f7d93456b16414f5aa47c44954e59b0ecf9b8b89018d6a"
const EXPECTED_MACHINE = "1b490fe20bf3d61dc1f14e3a6e7fe38fc7de69c14face211fdd5afd0544c9c8b"
const EXPECTED_STORAGE_UUID = "5744648d-9289-4d4e-ac6a-707e8405a5d6"
const EXPECTED_TRUSTED_EVIDENCE = Object.freeze({
  "config/execution-fabric/remote-dev-offload-v1-inactive-scope.json": "df58b16da25a8a39668f04ddc6af79842ede3376695446f6fecfdf4cde2fe18a",
  "config/execution-fabric/aegis-resident-identity.json": "69a9008e680ef236367c8b4b3ebf85b9d96dbc9cf3545b97c2275761b327643d",
  "config/execution-fabric/aegis-bounded-dispatch-authority-scopes/WO-EF-DISPATCH-AEGIS-001.json": "90f089b0d64989edafcc96e847e77993a0c352d99a2716bbfb72bd3fbc27cfc7",
  "docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-claim.json": "40385c3163908c30d4eb559cded69ac2d05ae46c31a029dbbdc94d821139f845",
  "docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-lease.json": "c868754130d3c64b0ae2a8c5095d05a0ff978bf5ff0ff11eb76657422d7bef8d",
  "docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-release.json": "941173d93f64b806918d007552a7417cef122363442c8110d78c615ea1f039b2",
  "docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-replay-evidence.json": "302bbf305171000f3dacb4af33fa62ce89011e5ddcb3641d729fbc2f4eae5e90",
})
const EXPECTED_STEPS = Object.freeze([
  "RECONCILE_BOUNDED_IDENTITY", "INSTALL_ROOT_LAUNCH_ASSETS", "INSTALL_DUAL_STACK_BROKER_BOUNDARY",
  "INSTALL_GITHUB_HOST_AUTH_BOUNDARY", "RECONCILE_TRUSTED_REPOSITORIES", "INSTALL_PINNED_TOOLCHAIN",
  "CREATE_DURABLE_LEDGER", "INSTALL_FORCED_COMMAND_TRANSPORT",
])
const VERIFIER_PATH = fileURLToPath(import.meta.url)
const OWNER_PUBLIC_KEY_PATH = "/etc/williamos-fabric/owner-prerequisite-authority.pem"
const INSTALLED_VERIFIER_PATH = "/usr/local/libexec/williamos-aegis-root-handoff.mjs"
const INSTALLED_ADAPTER_PATH = "/usr/local/libexec/williamos-aegis-root-os-adapter.mjs"
const INSTALLED_CLI_PATH = "/usr/local/sbin/williamos-aegis-root-handoff"
const INSTALLED_MANIFEST_PATH = "/usr/local/share/williamos/aegis-root-handoff-bundle/config/execution-fabric/aegis-remote-dev-root-handoff.json"
const AUTHORITY_ROOT = "/var/lib/williamos-fabric/remote-dev-prerequisite-handoff/authorities"
const BUNDLE_ROOT = "/usr/local/share/williamos/aegis-root-handoff-bundle"
const STAGED_ROOT = "/var/lib/williamos-fabric/remote-dev-prerequisite-handoff/staged"
const EXPECTED_ASSET_DIGESTS = Object.freeze({
  "config/execution-fabric/aegis-remote-dev-prerequisites.json": "3f4124737a4339e34534c15201db08e1bd271b59483a459ab76ea5ff284dc582",
  "scripts/execution-fabric/provision/aegis-remote-dev-prerequisites.mjs": "843727481311ee5303a14fd67dcd05334e6e75cfd242bf54d13e35f8ae688d46",
  "scripts/execution-fabric/provision/aegis-remote-dev-prerequisites.sh": "7e92a1b3acf541f978f086ee1cec8191cc2b9732bc7f83380e4ecb13fec8d9d4",
  "scripts/execution-fabric/provision/aegis-remote-dev-ssh-entrypoint.mjs": "018406b0621df8b306bee113c4ea7cbed2e3af7c0d53d15e4d8dcb3cc59d3dd7",
  "scripts/execution-fabric/live/aegis-remote-dev-network-launcher.mjs": "1543dcda442bbbd06996f536a11652f21ea7bf9ba8fd6927ac710a21930c1d90",
  "scripts/execution-fabric/live/aegis-resident-network-boundary.mjs": "c4c664578cf8d43822b28c0421ac7fa7a96a06cc9203fd15f4474264b4665507",
  "scripts/execution-fabric/live/aegis-remote-dev-worker.sh": "ce1e33480f4d6262fcf682eb849008a82d4bc147413c145f537225e2fb394fa1",
  "config/execution-fabric/aegis-resident-network-boundary.json": "212e330a8647cb73b77f2d5b1d922495bc41baf06d4aca47dcbac5fc98604bb6",
  "scripts/execution-fabric/provision/aegis-remote-dev-root-os-adapter.mjs": "46b357e65e0e9282955f2e88632a7d2fcca5c5fde75fab95461c0adf8f477b9c",
  "scripts/execution-fabric/provision/aegis-remote-dev-root-handoff.sh": "4f76725ae7188ae676b5afde4d1622a8c6cdaea0b1bc8d1288dab04700b17ccd",
  "scripts/execution-fabric/provision/assets/90-williamos-aegis-github.conf": "bb6967f25ae614d152c2bbaf4073eae4575f98819f9b4a855b5de20a60e4e789",
  "scripts/execution-fabric/provision/assets/90-williamos-fabric-remote-dev.conf": "a6e83ce0c8b2d2c8127a268c5bd48f27ff3199894f0179afc412a5b01f7fe9c6",
  "scripts/execution-fabric/provision/assets/aegis-remote-dev-egress-enforcer.mjs": "931b0a9b0e98f4e6f3cc023e83e07914eafea53ae1844858e89f68e86247b1d5",
  "scripts/execution-fabric/provision/assets/aegis-remote-dev-egress-broker.mjs": "8c2b7f13fde3971f8ea633f7aaf2afda36b319439a04dac86d1164270f978c4a",
  "scripts/execution-fabric/provision/assets/aegis-remote-dev-runtime-authority.mjs": "9f1aa89954ecc3f8ff85d58b65dc18892f4d5ab31e79ab48e3aeac2f544c0ebf",
  "scripts/execution-fabric/provision/assets/aegis-remote-dev-proxy-connect.mjs": "45a29680a83ff59fb925f998faf819915ec45ee22237f1b3a2679b6f496a8346",
  "scripts/execution-fabric/provision/assets/aegis-remote-dev-git-client.mjs": "27ddbbbb3bcfc1278f1b3e043ba5d30e5627b6071f633ce699c1ab7bd1e55e49",
  "scripts/execution-fabric/provision/assets/aegis-remote-dev-git-broker.mjs": "3730a0e98af480a796ffa7cdd0ae61faef0490cbd891212e6e926c258021c112",
  "scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-broker.service": "540a3137c055896f1ad223d64c7a0af94eb01a7fb89fefc81f045b8e6ca6d3e7",
  "scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-git-broker.socket": "116392f032d35c89f473522a1420f46715cbd4e2ae5c2853bc6adf8bb6e4ad15",
  "scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-git-broker.service": "04b97efce77ccf7792f3eb91f47018b549a18a49e2040c9c3a369823e068ab2e",
  "scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-egress.nft": "7ae54384fa8eea7ad5c35bbeff4ae00bfb8b0f9f83fdfcd4bfeeb6622d59e867",
  "scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-egress.service": "36e5b23c6e0937a5ee76ef5d7249e4ff13babfb0664f84a91626f5e20193a83a",
  "scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev.slice": "fc588c814d41b0f5be77ac7436d02f95644aa03b373912f70da6c41a61baff7c",
  "scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev.tmpfiles": "108fa6b6d3e9140868cf50c900c36e96fcd58dcfddb01ce631a57a27c389f96f",
  "scripts/execution-fabric/provision/assets/williamos-dotnet-broker-wrapper": "413e6a5e6e0be458c1b1135f9b6948cfd84e9ad85df7bca9286329213277203c",
})

function canonicalizeJcs(value) {
  if (value === null) return "null"
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("non-finite JCS number"); return JSON.stringify(value) }
  if (typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return `[${value.map(canonicalizeJcs).join(",")}]`
  if (!value || typeof value !== "object") throw new Error("unsupported JCS value")
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalizeJcs(value[key])}`).join(",")}}`
}
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex") }
function rawSha(bytes) { return sha256(Buffer.from(bytes)) }
function canonicalSha(value) { return sha256(Buffer.from(canonicalizeJcs(value), "utf8")) }
function same(left, right) { return canonicalizeJcs(left) === canonicalizeJcs(right) }
function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !same(Object.keys(value).sort(), [...keys].sort())) throw new Error(`${label} fields differ`)
}
function blocked(reasonCode, detail, drift = []) {
  return { status: "BLOCKED", reasonCode, detail, executionAuthorized: false, applyAuthorized: false, rollbackAuthorized: false, mutations: [], drift }
}

function reviewedSourceBytes(repoRoot, relativePath) {
  const git = spawnSync("git", ["--no-replace-objects", "show", `HEAD:${relativePath.replaceAll("\\", "/")}`], {
    cwd: repoRoot,
    encoding: null,
    shell: false,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1", GIT_OPTIONAL_LOCKS: "0" },
  })
  if (git.status === 0 && Buffer.isBuffer(git.stdout)) return git.stdout
  return fs.readFileSync(path.join(repoRoot, relativePath))
}

export function validateRootHandoffManifest(raw) {
  const value = structuredClone(raw)
  exact(value, ["schemaVersion", "handoffId", "status", "trustedMain", "prerequisitePackage", "target", "bootstrap", "storage", "posture", "authority", "evidence", "trustedEvidence", "steps", "appliedAssets", "rollback"], "manifest")
  if (value.schemaVersion !== 1 || value.handoffId !== "aegis-remote-dev-root-handoff-issue-734-v1" || value.status !== "UNTRUSTED_UNTIL_ROOT_BOOTSTRAP") throw new Error("handoff identity differs")
  if (!same(value.trustedMain, { repository: "bsvalues/terragroq", remote: "https://github.com/bsvalues/terragroq.git", ref: "refs/heads/main", minimumCommit: EXPECTED_COMMIT, freshRemoteAuthorityEqualityRequired: true, replaceObjectsDisabled: true, configIsolationRequired: true })) throw new Error("trusted-main boundary differs")
  exact(value.prerequisitePackage, ["packageId", "generationBaseCommit", "canonicalManifestPath", "semanticSupersession", "historicalSuccessClaimed", "supersededPreflight"], "prerequisitePackage")
  if (value.prerequisitePackage.packageId !== "aegis-remote-dev-root-prerequisites-issue-734-v2" || value.prerequisitePackage.generationBaseCommit !== EXPECTED_COMMIT
    || value.prerequisitePackage.canonicalManifestPath !== MANIFEST_PATH || value.prerequisitePackage.semanticSupersession !== true || value.prerequisitePackage.historicalSuccessClaimed !== false) throw new Error("canonical prerequisite package differs")
  if (!same(value.prerequisitePackage.supersededPreflight, { packageId: "aegis-remote-dev-prerequisites-issue-734-v1", manifestPath: "config/execution-fabric/aegis-remote-dev-prerequisites.json", manifestJcsSha256: EXPECTED_PACKAGE_JCS, plannerPath: "scripts/execution-fabric/provision/aegis-remote-dev-prerequisites.mjs", installerPath: "scripts/execution-fabric/provision/aegis-remote-dev-prerequisites.sh" })) throw new Error("superseded preflight provenance differs")
  if (!same(value.target, { nodeId: "aegis", hostname: "aegis", machineIdSha256: EXPECTED_MACHINE, os: "linux", effectiveUid: 0 })) throw new Error("root target differs")
  if (!same(value.bootstrap, { verifierPath: "/usr/local/libexec/williamos-aegis-root-handoff.mjs", verifierMode: "0555", adapterPath: "/usr/local/libexec/williamos-aegis-root-os-adapter.mjs", adapterMode: "0555", cliPath: "/usr/local/sbin/williamos-aegis-root-handoff", cliMode: "0555", manifestPath: INSTALLED_MANIFEST_PATH, manifestMode: "0444", bundleRoot: BUNDLE_ROOT, evidenceDirectoriesPrecreated: true, ownerPublicKeyPath: "/etc/williamos-fabric/owner-prerequisite-authority.pem", ownerPublicKeyMode: "0444", outOfBandRootInstallRequired: true })) throw new Error("external bootstrap differs")
  if (!same(value.storage, { mode: "VERIFY_ONLY", mechanism: "LOOPBACK_XFS_PROJECT_QUOTA_V1", backingImageRealPath: "/var/lib/williamos/fabric/aegis-remote-dev-workspaces.xfs", backingImageBytes: 107374182400, filesystemUuid: EXPECTED_STORAGE_UUID, mountPath: "/srv/william", projectId: 734, hardLimitBytes: 85899345920, formatAllowed: false, mountAllowed: false, remountAllowed: false, quotaMutationAllowed: false, workspaceCreationAllowed: false })) throw new Error("storage posture differs")
  if (!same(value.posture, { proofActivation: "INACTIVE_PENDING_PREREQUISITES", generalSchedulerEnabled: false, standingAegisAuthorityEnabled: false, dispatchAuthorized: false, closedHashWorkOrder: "WO-EF-DISPATCH-AEGIS-001", closedHashMutationAllowed: false, atlasAllowed: false, hermesConfigurationMutationAllowed: false })) throw new Error("posture differs")
  if (!same(value.steps.map((step) => step.id), EXPECTED_STEPS)) throw new Error("step order differs")
  for (const step of value.steps) {
    exact(step, ["id", "idempotencyPredicate", "rollbackClass"], `step ${step.id}`)
    if (!/^[A-Z][A-Z0-9_]+$/.test(step.id) || typeof step.idempotencyPredicate !== "string" || step.idempotencyPredicate.length < 3 || !["RESTORE_IF_UNCHANGED", "PRESERVE_EVIDENCE", "DISABLE_ONLY"].includes(step.rollbackClass)) throw new Error("step contract differs")
  }
  if (!Array.isArray(value.appliedAssets) || value.appliedAssets.length < 7) throw new Error("applied asset graph incomplete")
  if (!same(value.appliedAssets.map((asset) => asset.source), Object.keys(EXPECTED_ASSET_DIGESTS))) throw new Error("applied asset set differs")
  const sources = new Set(); const destinations = new Set()
  for (const asset of value.appliedAssets) {
    exact(asset, ["source", "destination", "sha256", "owner", "group", "mode"], "applied asset")
    if (!asset.source.startsWith("scripts/execution-fabric/") && !asset.source.startsWith("config/execution-fabric/")) throw new Error("applied asset source differs")
    if (!path.posix.isAbsolute(asset.destination) || asset.sha256 !== EXPECTED_ASSET_DIGESTS[asset.source] || asset.owner !== "root" || !/^0[0-7]{3}$/.test(asset.mode) || sources.has(asset.source) || destinations.has(asset.destination)) throw new Error("applied asset binding differs")
    sources.add(asset.source); destinations.add(asset.destination)
  }
  exact(value.authority, ["algorithm", "maximumAgeSeconds", "resumeWindowSeconds", "singleUse", "consumeBeforeMutation", "claimDirectory", "leasePath", "requiredConcreteInputs"], "authority")
  if (value.authority.algorithm !== "Ed25519" || value.authority.maximumAgeSeconds !== 900 || value.authority.resumeWindowSeconds !== 1800 || value.authority.singleUse !== true || value.authority.consumeBeforeMutation !== true) throw new Error("authority posture differs")
  if (!same(value.evidence, { namespace: "WO-TF-REMOTE-DEV-OFFLOAD-001/prerequisite-handoff", path: "/var/lib/williamos-fabric/remote-dev-prerequisite-handoff", owner: "root", mode: "0700", hashChained: true, appendOnly: true, fsyncRequired: true, successReceipt: "/var/lib/williamos-fabric/remote-dev-prerequisite-verified.json" })) throw new Error("evidence boundary differs")
  if (!Array.isArray(value.trustedEvidence) || !same(value.trustedEvidence.map((entry) => entry.path), Object.keys(EXPECTED_TRUSTED_EVIDENCE))) throw new Error("trusted evidence set differs")
  for (const entry of value.trustedEvidence) {
    exact(entry, ["path", "sha256", "purpose"], "trusted evidence")
    if (entry.sha256 !== EXPECTED_TRUSTED_EVIDENCE[entry.path] || typeof entry.purpose !== "string" || entry.purpose.length < 3) throw new Error("trusted evidence binding differs")
  }
  if (!same(value.rollback, { automatic: false, separateSignedAuthorityRequired: true, preserveStorage: true, preserveSigningKey: true, preserveTickets: true, preserveLedger: true, restoreOnlyIfInstalledDigestMatches: true })) throw new Error("rollback boundary differs")
  return value
}

export function inspectRootHandoffBundle(repoRoot) {
  try {
    const manifest = validateRootHandoffManifest(JSON.parse(fs.readFileSync(path.join(repoRoot, MANIFEST_PATH), "utf8")))
    const drift = []
    for (const asset of manifest.appliedAssets) {
      const full = path.resolve(repoRoot, asset.source)
      if (!full.startsWith(`${path.resolve(repoRoot)}${path.sep}`)) { drift.push(asset.source); continue }
      try { if (fs.lstatSync(full).isSymbolicLink() || rawSha(reviewedSourceBytes(repoRoot, asset.source)) !== asset.sha256) drift.push(asset.source) } catch { drift.push(asset.source) }
    }
    if (drift.length) return blocked("BUNDLE_BINDING_DRIFT", "reviewed asset bytes differ", drift)
    return { status: "BUNDLE_INTERNAL_CONSISTENCY_ONLY", reasonCode: "EXTERNAL_ROOT_BOOTSTRAP_REQUIRED", externalTrustRootRequired: true, executionAuthorized: false, applyAuthorized: false, manifestSha256: canonicalSha(manifest), verifiedPaths: manifest.appliedAssets.map((asset) => asset.source), drift: [] }
  } catch (error) { return blocked("ROOT_HANDOFF_MANIFEST_INVALID", String(error?.message ?? error)) }
}

function exactStorage(manifest, observed) {
  const s = observed?.storage
  return s?.verified === true && s.mutationRequested === false && s.backingImageRealPath === manifest.storage.backingImageRealPath
    && s.backingHostFilesystem === "ext4" && s.backingImageBytes === manifest.storage.backingImageBytes && s.backingImageOwner === "root" && s.backingImageGroup === "root" && s.backingImageMode === "0600" && s.backingImageNlink === 1
    && typeof s.backingDevice === "string" && /^[0-9]+$/.test(s.backingDevice) && typeof s.backingInode === "string" && /^[0-9]+$/.test(s.backingInode) && typeof s.backingCtimeNs === "string" && /^[0-9]+$/.test(s.backingCtimeNs)
    && /^\/dev\/loop[0-9]+$/.test(s.loopDevice ?? "") && s.loopBackingImageRealPath === s.backingImageRealPath
    && s.mountSource === s.loopDevice && s.mountSourceMajorMinor === s.loopMajorMinor && /^[0-9]+:[0-9]+$/.test(s.loopMajorMinor ?? "")
    && s.filesystemType === "xfs" && s.filesystemUuid === manifest.storage.filesystemUuid && s.filesystemLabel === "AEGIS_RDEV" && s.mountPath === "/srv/william"
    && same([...(s.mountOptions ?? [])].sort(), ["exec", "nodev", "nosuid", "prjquota", "rw"])
    && s.projectId === 734 && s.projectInherit === true && s.quotaAccounting === true && s.quotaEnforcement === true && s.hardLimitBytes === manifest.storage.hardLimitBytes
}

export function buildRootHandoffPlan(rawManifest, observed) {
  let manifest
  try { manifest = validateRootHandoffManifest(rawManifest) } catch (error) { return blocked("ROOT_HANDOFF_MANIFEST_INVALID", String(error?.message ?? error)) }
  if (!exactStorage(manifest, observed)) return blocked("STORAGE_VERIFY_ONLY_DRIFT", "existing loopback XFS proof is absent or differs; storage mutation is forbidden")
  const platform = observed?.platform; const trusted = observed?.trustedMain; const bootstrap = observed?.bootstrap
  if (platform?.os !== "linux" || platform?.effectiveUid !== 0 || platform?.hostname !== "aegis" || platform?.machineIdSha256 !== manifest.target.machineIdSha256) return blocked("ROOT_MACHINE_IDENTITY_UNPROVEN", "root/Linux/canonical AEGIS identity differs")
  if (bootstrap?.verifierRootOwned !== true || bootstrap?.verifierMode !== "0555" || bootstrap?.ownerPublicKeyRootOwned !== true || bootstrap?.ownerPublicKeyMode !== "0444") return blocked("EXTERNAL_ROOT_BOOTSTRAP_UNPROVEN", "root verifier or owner public key trust differs")
  if (trusted?.remote !== manifest.trustedMain.remote || trusted?.ref !== manifest.trustedMain.ref || trusted?.minimumCommit !== manifest.trustedMain.minimumCommit
    || !SHA40.test(trusted?.authorityCommit ?? "") || trusted?.freshRemoteAuthorityEquality !== true || trusted?.exactCleanHead !== true
    || trusted?.replaceObjectsDisabled !== true || trusted?.configIsolation !== true || trusted?.criticalBytesMatch !== true) return blocked("TRUSTED_MAIN_UNPROVEN", "fresh authority-bound remote equality or critical working bytes differ")
  if (observed?.scheduler?.enabled !== false || observed.scheduler.standingAuthority !== false || observed.scheduler.dispatchOccurred !== false) return blocked("INACTIVE_POSTURE_DRIFT", "scheduler, standing authority, or dispatch posture differs")
  if (observed?.closedHash?.changed !== false) return blocked("CLOSED_HASH_SCOPE_DRIFT", "closed HASH authority or evidence differs")
  const mutations = []
  for (const step of manifest.steps) {
    const state = observed?.prerequisites?.[step.id]
    if (state === "DRIFT" || (state !== "ABSENT" && state !== "MATCH")) return blocked("PREREQUISITE_DRIFT", `${step.id} state is not exact`, [step.id])
    if (state === "ABSENT") mutations.push({ id: step.id, idempotencyPredicate: step.idempotencyPredicate })
  }
  return { status: mutations.length ? "READY_FOR_SIGNED_AUTHORITY" : "ALREADY_VERIFIED", reasonCode: mutations.length ? "SIGNED_OWNER_AUTHORITY_REQUIRED" : "NO_MUTATION_REQUIRED", executionAuthorized: false, applyAuthorized: false, rollbackAuthorized: false, drift: [], mutations }
}

export function validateOwnerAuthority(rawManifest, envelope, publicKey, now, consumed) {
  let manifest
  try { manifest = validateRootHandoffManifest(rawManifest) } catch (error) { return blocked("ROOT_HANDOFF_MANIFEST_INVALID", String(error?.message ?? error)) }
  try {
    exact(envelope, ["payload", "signature"], "authority envelope")
    const p = envelope.payload
    exact(p, ["schemaVersion", "authorityId", "transactionId", "operation", "workOrderId", "issue", "machineIdSha256", "bootId", "trustedMainCommit", "rootHandoffManifestSha256", "verifierSha256", "historicalPreflightManifestJcsSha256", "appliedAssets", "inputs", "storage", "allowedSteps", "rollback", "issuedAt", "expiresAt", "resumeExpiresAt", "singleUse"], "authority payload")
    if (consumed) return blocked("OWNER_AUTHORITY_CONSUMED", "owner authority already has a durable claim")
    if (p.schemaVersion !== 1 || !GUID.test(p.authorityId) || !GUID.test(p.transactionId) || !GUID.test(p.bootId) || p.operation !== "APPLY_PREREQUISITES" || p.workOrderId !== "WO-TF-REMOTE-DEV-OFFLOAD-001" || p.issue?.repository !== "bsvalues/terrafusion_os_1.0" || p.issue?.number !== 734 || p.singleUse !== true) throw new Error("owner authority identity differs")
    if (p.machineIdSha256 !== manifest.target.machineIdSha256 || !SHA40.test(p.trustedMainCommit) || p.rootHandoffManifestSha256 !== canonicalSha(manifest) || p.verifierSha256 !== rawSha(fs.readFileSync(VERIFIER_PATH)) || p.historicalPreflightManifestJcsSha256 !== manifest.prerequisitePackage.supersededPreflight.manifestJcsSha256 || !same(p.appliedAssets, manifest.appliedAssets) || !same(p.allowedSteps, EXPECTED_STEPS)) throw new Error("owner authority binding differs")
    if (!same(p.storage, { mode: "VERIFY_ONLY", filesystemUuid: EXPECTED_STORAGE_UUID, projectId: 734, hardLimitBytes: 85899345920 })) throw new Error("owner authority storage differs")
    if (!same(p.rollback, { automatic: false, separateSignedAuthorityRequired: true, preserveEvidence: true, preserveStorage: true })) throw new Error("owner authority rollback differs")
    exact(p.inputs, ["hermesTransportPublicKeySha256", "hermesTransportKeyFingerprint", "githubAccountPublicKeySha256", "githubAccountPrivateKeySha256", "githubAccountKeyFingerprint", "githubHostKnownHostsSha256", "githubHostKeyFingerprint", "toolchain", "launchSigningKeyAction", "launchSigningPrivateKeySha256", "launchSigningPublicKeySha256", "launchSigningKeyFingerprint"], "authority inputs")
    for (const value of [p.inputs.hermesTransportPublicKeySha256, p.inputs.githubAccountPublicKeySha256, p.inputs.githubAccountPrivateKeySha256, p.inputs.githubHostKnownHostsSha256]) if (!SHA256.test(value)) throw new Error("key digest differs")
    for (const value of [p.inputs.hermesTransportKeyFingerprint, p.inputs.githubAccountKeyFingerprint, p.inputs.githubHostKeyFingerprint]) if (typeof value !== "string" || !value.startsWith("SHA256:") || PLACEHOLDER.test(value)) throw new Error("concrete key fingerprint required")
    if (p.inputs.launchSigningKeyAction === "GENERATE_ON_AEGIS") {
      if (p.inputs.launchSigningPrivateKeySha256 !== null || p.inputs.launchSigningPublicKeySha256 !== null || p.inputs.launchSigningKeyFingerprint !== null) throw new Error("generated launch key must not be preclaimed")
    } else if (p.inputs.launchSigningKeyAction === "ADOPT_EXACT_EXISTING") {
      if (!SHA256.test(p.inputs.launchSigningPrivateKeySha256) || !SHA256.test(p.inputs.launchSigningPublicKeySha256) || typeof p.inputs.launchSigningKeyFingerprint !== "string" || !p.inputs.launchSigningKeyFingerprint.startsWith("SHA256:") || PLACEHOLDER.test(p.inputs.launchSigningKeyFingerprint)) throw new Error("adopted launch key binding differs")
    } else throw new Error("launch key action differs")
    const versions = { git: "2.43.0", node: "22.18.0", dotnetSdk: "8.0.423", corepack: "0.34.0", pnpm: "9.0.0" }
    const sources = { git: "PREINSTALLED:/usr/bin/git", node: "PREINSTALLED:/usr/bin/node", dotnetSdk: "STAGED:dotnet-sdk-8.0.423-linux-x64.tar.gz", corepack: "PREINSTALLED:/usr/bin/corepack", pnpm: "PREINSTALLED:/usr/bin/pnpm" }
    exact(p.inputs.toolchain, Object.keys(versions), "toolchain inputs")
    for (const [name, version] of Object.entries(versions)) {
      const item = p.inputs.toolchain[name]; exact(item, ["version", "source", "sha256"], `toolchain ${name}`)
      if (item.version !== version || item.source !== sources[name] || PLACEHOLDER.test(item.source) || !SHA256.test(item.sha256)) throw new Error(`toolchain ${name} provenance differs`)
    }
    const issued = Date.parse(p.issuedAt); const expires = Date.parse(p.expiresAt); const resumeExpires = Date.parse(p.resumeExpiresAt); const current = Date.parse(now)
    if (![issued, expires, resumeExpires, current].every(Number.isFinite) || expires - issued !== 900_000 || resumeExpires - expires !== 1_800_000 || current < issued || current >= resumeExpires) return blocked("OWNER_AUTHORITY_EXPIRED", "owner authority is outside its exact initial or bounded resume window")
    const signature = Buffer.from(envelope.signature, "base64")
    if (signature.toString("base64") !== envelope.signature || !crypto.verify(null, Buffer.from(canonicalizeJcs(p), "utf8"), publicKey, signature)) throw new Error("owner authority signature differs")
    if (current >= expires) return { status: "OWNER_AUTHORITY_RESUME_ONLY_VERIFIED", reasonCode: "EXACT_CONSUMED_TRANSACTION_REQUIRED", authorityId: p.authorityId, transactionId: p.transactionId, executionAuthorized: false, applyAuthorized: false }
    return { status: "OWNER_AUTHORITY_VERIFIED", reasonCode: "EXTERNAL_SIGNATURE_VERIFIED", authorityId: p.authorityId, transactionId: p.transactionId, executionAuthorized: false, applyAuthorized: false }
  } catch (error) { return blocked("OWNER_AUTHORITY_INVALID", String(error?.message ?? error)) }
}

function journalRecord(previous, sequence, phase, detail) {
  const record = { schemaVersion: 1, sequence, previousSha256: previous, phase, detail }
  return { ...record, recordSha256: canonicalSha(record) }
}

// Transaction protocol model. Production authority is the separately installed root verifier;
// callers must never treat this returned object as an activation or dispatch receipt.
export async function executeRootHandoffTransaction(manifest, envelope, publicKey, now, adapter) {
  const authority = validateOwnerAuthority(manifest, envelope, publicKey, now, false)
  if (authority.status !== "OWNER_AUTHORITY_VERIFIED" && authority.status !== "OWNER_AUTHORITY_RESUME_ONLY_VERIFIED") return authority
  const initialWindow = authority.status === "OWNER_AUTHORITY_VERIFIED"
  let lease = false; let previous = "0".repeat(64); let sequence = 0; let recovery = { records: [], committed: false }; let committed = false
  const append = async (phase, detail) => { const record = journalRecord(previous, ++sequence, phase, detail); await adapter.append(record); previous = record.recordSha256 }
  try {
    lease = await adapter.acquireLease(envelope.payload.transactionId)
    if (!lease) return blocked("ROOT_HANDOFF_LEASE_BUSY", "another root provisioning transaction owns the node")
    const observed = await adapter.reprove()
    const plan = buildRootHandoffPlan(manifest, observed)
    if (plan.status !== "READY_FOR_SIGNED_AUTHORITY" && plan.status !== "ALREADY_VERIFIED") return plan
    const claim = await adapter.claim(envelope.payload.authorityId, envelope.payload.transactionId, initialWindow)
    const resume = typeof claim === "object" && claim?.resume === true
    if (!initialWindow && !resume) return blocked("OWNER_AUTHORITY_EXPIRED", "initial authority window elapsed and no exact durable claim exists")
    if (claim !== true && !resume) return blocked("OWNER_AUTHORITY_CONSUMED", "owner authority already has a durable claim")
    if (resume) {
      recovery = await adapter.recover(envelope.payload.authorityId, envelope.payload.transactionId)
      if (!recovery || !Array.isArray(recovery.records)) throw new Error("durable recovery evidence is unavailable")
      sequence = recovery.records.at(-1)?.sequence ?? 0; previous = recovery.records.at(-1)?.recordSha256 ?? "0".repeat(64)
      if (recovery.committed === true) {
        committed = true
        const current = buildRootHandoffPlan(manifest, await adapter.verify())
        if (current.status !== "ALREADY_VERIFIED") throw new Error("committed prerequisite state no longer verifies")
        await adapter.publishSuccess(envelope.payload, previous)
        return { status: "PREREQUISITES_APPLIED_VERIFIED", reasonCode: "ROOT_HANDOFF_COMMITTED", transactionId: envelope.payload.transactionId, finalEvidenceSha256: previous, executionAuthorized: false, applyAuthorized: false, rollbackAuthorized: false }
      }
      if (recovery.records.length === 0) await append("AUTHORITY_CONSUMED", { authorityId: envelope.payload.authorityId, transactionId: envelope.payload.transactionId })
    } else await append("AUTHORITY_CONSUMED", { authorityId: envelope.payload.authorityId, transactionId: envelope.payload.transactionId })
    let applied = new Set(recovery.records.filter((record) => record.phase === "STEP_APPLIED").map((record) => record.detail?.stepId))
    const intended = new Set(recovery.records.filter((record) => record.phase === "STEP_INTENT").map((record) => record.detail?.stepId))
    const pendingIntent = [...recovery.records].reverse().find((record) => record.phase === "STEP_INTENT" && !applied.has(record.detail?.stepId))?.detail?.stepId
    if (pendingIntent && await adapter.effectApplied(pendingIntent)) {
      await append("STEP_APPLIED", { stepId: pendingIntent })
      applied = new Set([...applied, pendingIntent])
    }
    for (const step of plan.mutations) {
      if (applied.has(step.id)) continue
      if (!intended.has(step.id)) await append("STEP_INTENT", { stepId: step.id })
      if (!await adapter.effectApplied(step.id)) await adapter.apply(step.id)
      await append("STEP_APPLIED", { stepId: step.id })
    }
    const verified = buildRootHandoffPlan(manifest, await adapter.verify())
    if (verified.status !== "ALREADY_VERIFIED") throw new Error("post-apply prerequisite verification differs")
    if (!recovery.records.some((record) => record.phase === "POST_APPLY_VERIFIED")) {
      await append("POST_APPLY_VERIFIED", { storage: "VERIFY_ONLY", scheduler: "DISABLED", standingAuthority: false, dispatchOccurred: false })
    }
    await append("COMMITTED", { transactionId: envelope.payload.transactionId })
    committed = true
    await adapter.publishSuccess(envelope.payload, previous)
    return { status: "PREREQUISITES_APPLIED_VERIFIED", reasonCode: "ROOT_HANDOFF_COMMITTED", transactionId: envelope.payload.transactionId, finalEvidenceSha256: previous, executionAuthorized: false, applyAuthorized: false, rollbackAuthorized: false }
  } catch (error) {
    if (!committed) try { await append("FAILED_PARTIAL", { detail: String(error?.message ?? error).slice(0, 256) }) } catch {}
    return { ...blocked(committed ? "SUCCESS_RECEIPT_UNPUBLISHED" : "PARTIAL_APPLY_INERT", committed ? "prerequisite transaction committed but canonical success receipt is unavailable; activation remains disabled" : "prerequisite apply did not commit; activation remains disabled"), transactionId: envelope.payload.transactionId, finalEvidenceSha256: previous }
  } finally { if (lease) await adapter.releaseLease(envelope.payload.transactionId) }
}

function fixedRun(executable, args, statuses = [0]) {
  const result = spawnSync(executable, args, { encoding: "utf8", shell: false, timeout: 30_000, maxBuffer: 4 * 1024 * 1024, env: { HOME: "/nonexistent", PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1" } })
  if (result.error || !statuses.includes(result.status)) throw new Error(`${path.basename(executable)} trust proof failed`)
  return String(result.stdout ?? "").trim()
}
function rootFile(file, mode) {
  const resolved = fs.realpathSync(file); if (resolved !== file) throw new Error(`${file} is not an exact path`)
  let cursor = "/"; for (const segment of file.slice(1).split("/")) { cursor = path.join(cursor, segment); const stat = fs.lstatSync(cursor); if (stat.isSymbolicLink()) throw new Error(`${file} contains a symlink`); if (cursor !== file && (!stat.isDirectory() || stat.uid !== 0 || (stat.mode & 0o022) !== 0)) throw new Error(`${file} parent is not root-controlled`) }
  const stat = fs.lstatSync(file); if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== 0 || (stat.mode & 0o7777) !== mode) throw new Error(`${file} trust differs`)
  return fs.readFileSync(file)
}
function productionTrust(manifest, authority) {
  if (process.platform !== "linux" || process.getuid?.() !== 0 || fileURLToPath(import.meta.url) !== INSTALLED_VERIFIER_PATH || process.execPath !== "/usr/bin/node") throw new Error("installed root verifier identity differs")
  rootFile(INSTALLED_VERIFIER_PATH, 0o555); rootFile(OWNER_PUBLIC_KEY_PATH, 0o444); rootFile(INSTALLED_MANIFEST_PATH, 0o444)
  const cliAsset = manifest.appliedAssets.find((asset) => asset.destination === INSTALLED_CLI_PATH)
  if (!cliAsset || sha256(rootFile(INSTALLED_CLI_PATH, 0o555)) !== cliAsset.sha256) throw new Error("installed root CLI differs")
  const remote = fixedRun("/usr/bin/git", ["-c", "protocol.file.allow=never", "ls-remote", "--exit-code", manifest.trustedMain.remote, manifest.trustedMain.ref]).split(/\s+/)[0]
  if (remote !== authority.trustedMainCommit) throw new Error("fresh origin/main authority equality differs")
  const ancestry = fs.mkdtempSync("/tmp/williamos-root-trust-")
  try {
    fixedRun("/usr/bin/git", ["--no-replace-objects", "init", "--bare", ancestry])
    fixedRun("/usr/bin/git", ["--no-replace-objects", "-C", ancestry, "fetch", "--no-tags", "--force", manifest.trustedMain.remote, `${manifest.trustedMain.ref}:refs/williamos/authority-main`])
    if (fixedRun("/usr/bin/git", ["--no-replace-objects", "-C", ancestry, "rev-parse", "refs/williamos/authority-main"]) !== authority.trustedMainCommit) throw new Error("fetched authority main differs")
    fixedRun("/usr/bin/git", ["--no-replace-objects", "-C", ancestry, "merge-base", "--is-ancestor", manifest.trustedMain.minimumCommit, authority.trustedMainCommit])
  } finally { fs.rmSync(ancestry, { recursive: true, force: true }) }
  for (const asset of manifest.appliedAssets) {
    const source = path.join(BUNDLE_ROOT, ...asset.source.split("/")); const bytes = rootFile(source, asset.mode === "0555" ? 0o555 : 0o444)
    if (sha256(bytes) !== asset.sha256) throw new Error(`${asset.source} exact bundle bytes differ`)
  }
  for (const evidence of manifest.trustedEvidence) {
    const source = path.join(BUNDLE_ROOT, ...evidence.path.split("/")); const bytes = rootFile(source, 0o444)
    if (sha256(bytes) !== evidence.sha256) throw new Error(`${evidence.path} trusted evidence bytes differ`)
  }
  const inactive = JSON.parse(rootFile(path.join(BUNDLE_ROOT, "config/execution-fabric/remote-dev-offload-v1-inactive-scope.json"), 0o444))
  if (inactive.status !== "OWNER_AUTHORIZED_EXCEPTION_INACTIVE" || inactive.executionAuthorized !== false || inactive.activationAllowed !== false
    || inactive.scheduler?.state !== "disabled" || inactive.scheduler?.standingAegisAuthority !== false || inactive.scheduler?.autonomousDispatch !== false
    || inactive.authoritySeparation?.consumedHashProof?.reuseAllowed !== false || inactive.authoritySeparation?.consumedHashProof?.mutationAllowed !== false) throw new Error("inactive scheduler or closed HASH posture differs")
  const cgroupRoot = "/sys/fs/cgroup"; const active = fs.readdirSync(cgroupRoot, { recursive: true }).some((entry) => String(entry).includes("williamos-aegis-remote-dev-") && String(entry).endsWith(".service"))
  if (active) throw new Error("proof worker is already active")
  const bootId = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()
  if (bootId !== authority.bootId || !GUID.test(bootId)) throw new Error("signed boot generation differs")
  return { bootstrap: { verifierRootOwned: true, verifierMode: "0555", ownerPublicKeyRootOwned: true, ownerPublicKeyMode: "0444" }, trustedMain: { remote: manifest.trustedMain.remote, ref: manifest.trustedMain.ref, minimumCommit: manifest.trustedMain.minimumCommit, authorityCommit: remote, freshRemoteAuthorityEquality: true, exactCleanHead: true, replaceObjectsDisabled: true, configIsolation: true, criticalBytesMatch: true }, scheduler: { enabled: inactive.scheduler.state !== "disabled", standingAuthority: inactive.scheduler.standingAegisAuthority, dispatchOccurred: active }, closedHash: { changed: false }, bootId, authorityId: authority.authorityId }
}
function productionInputs(authority) {
  const fixed = [
    ["hermes-transport.pub", authority.inputs.hermesTransportPublicKeySha256, authority.inputs.hermesTransportKeyFingerprint],
    ["github-account.pub", authority.inputs.githubAccountPublicKeySha256, authority.inputs.githubAccountKeyFingerprint],
    ["github-account.key", authority.inputs.githubAccountPrivateKeySha256, authority.inputs.githubAccountKeyFingerprint],
    ["github_known_hosts", authority.inputs.githubHostKnownHostsSha256, authority.inputs.githubHostKeyFingerprint],
  ]
  for (const [name, digest, fingerprint] of fixed) {
    const file = `${STAGED_ROOT}/${name}`; const bytes = rootFile(file, 0o400)
    if (sha256(bytes) !== digest) throw new Error(`${name} signed input digest differs`)
    const observed = fixedRun("/usr/bin/ssh-keygen", ["-lf", file, "-E", "sha256"])
    if (!observed.includes(fingerprint)) throw new Error(`${name} signed input fingerprint differs`)
  }
  for (const item of Object.values(authority.inputs.toolchain)) {
    const [kind, location] = item.source.split(":", 2)
    const file = kind === "PREINSTALLED" ? location : `${STAGED_ROOT}/${location}`
    const mode = kind === "PREINSTALLED" ? 0o755 : 0o400
    if (sha256(rootFile(file, mode)) !== item.sha256) throw new Error(`${item.source} toolchain digest differs`)
  }
}
function authorityFile(argument) {
  const name = typeof argument === "string" ? path.posix.basename(argument) : ""
  if (!GUID.test(name.replace(/\.json$/, "")) || argument !== `${AUTHORITY_ROOT}/${name}` || !name.endsWith(".json")) throw new Error("authority path differs")
  return rootFile(argument, 0o400)
}
async function productionMain() {
  try {
    process.umask(0o077)
    if (process.argv.length !== 4 || process.argv[2] !== "--locked-apply") throw new Error("fixed locked apply invocation required")
    const manifest = validateRootHandoffManifest(JSON.parse(rootFile(INSTALLED_MANIFEST_PATH, 0o444).toString("utf8")))
    const envelopeBytes = authorityFile(process.argv[3]); const envelope = JSON.parse(envelopeBytes.toString("utf8"))
    if (!Buffer.from(`${canonicalizeJcs(envelope)}\n`, "utf8").equals(envelopeBytes)) throw new Error("authority is not canonical JSON")
    const now = fixedRun("/usr/bin/date", ["-u", "+%Y-%m-%dT%H:%M:%S.%3NZ"])
    const publicKey = crypto.createPublicKey(rootFile(OWNER_PUBLIC_KEY_PATH, 0o444))
    const authority = validateOwnerAuthority(manifest, envelope, publicKey, now, false)
    if (authority.status !== "OWNER_AUTHORITY_VERIFIED" && authority.status !== "OWNER_AUTHORITY_RESUME_ONLY_VERIFIED") throw new Error(authority.reasonCode)
    const trust = productionTrust(manifest, envelope.payload)
    productionInputs(envelope.payload)
    const adapterAsset = manifest.appliedAssets.find((asset) => asset.destination === INSTALLED_ADAPTER_PATH)
    if (!adapterAsset || sha256(rootFile(INSTALLED_ADAPTER_PATH, 0o555)) !== adapterAsset.sha256) throw new Error("installed root adapter differs")
    const { createRootProductionAdapter } = await import(`file://${INSTALLED_ADAPTER_PATH}`)
    const underlying = createRootProductionAdapter(manifest, envelope.payload, trust)
    const adapter = Object.freeze({ ...underlying, reprove: async () => ({ ...await underlying.reprove(), ...trust }), verify: async () => ({ ...await underlying.verify(), ...trust }) })
    const result = await executeRootHandoffTransaction(manifest, envelope, publicKey, now, adapter)
    process.stdout.write(`${JSON.stringify(result)}\n`); process.exitCode = result.status === "PREREQUISITES_APPLIED_VERIFIED" ? 0 : 2
  } catch (error) { process.stdout.write(`${JSON.stringify(blocked("ROOT_HANDOFF_BLOCKED", String(error?.message ?? error)))}\n`); process.exitCode = 2 }
}
if (process.argv[1] && path.resolve(process.argv[1]) === VERIFIER_PATH && process.argv[2] === "--locked-apply") productionMain()
