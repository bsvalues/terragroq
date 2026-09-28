import { createHash } from "node:crypto"
import { execFile } from "node:child_process"

import { z } from "zod"

import { hashRecord } from "@/lib/governance/hash"
import { normalizeRepositoryIdentity } from "@/lib/projects/workspace-project-binding"

const SHA40 = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/
const IMAGE = /^sha256:[0-9a-f]{64}$/
const SAFE_EVIDENCE_PATH = /^(?![/\\])(?!.*(?:^|\/)\.\.?($|\/))(?!.*[:\\])[A-Za-z0-9_./-]+$/

export const PRODUCT_TERMINAL_CATALOG_PATH = "os-platform/core/canon/release-closeout/catalog.json"
export const WACO_PRODUCT_TERMINAL_BINDING = Object.freeze({
  admissionOperation: "space.external_work_order.admit",
  admissionSource: "other",
  externalRef: "WO-TERRAFUSION-WACO-PARALLEL-EXECUTION-001",
  repository: "bsvalues/terrafusion_os_1.0",
  provenanceDigest: "7ccb6644263e2c120d8bf0e33170eec56d1eb1d54602dc5f81d693a0b94c33da",
  schemaVersion: "terrafusion.product-terminal-receipt.v1",
  productId: "terrafusion",
  releaseId: "waco-2026",
  terminalState: "WACO_2026_TERRAFUSION_RELEASE_READY",
  releaseSha: "35e32462d9758473e3a193388cd50786dc63cc17",
  deploymentId: "omen-waco-2026",
  machine: "OMEN",
  profileId: "waco-2026",
  receiptPath: "os-platform/core/canon/release-closeout/receipts/waco-2026.product-terminal.json",
  profilePath: "os-platform/core/canon/release-closeout/waco-2026.policy.json",
} as const)

const hex = z.string().regex(SHA256)
const container = z.object({
  name: z.string().min(1), id: hex, image: z.string().regex(IMAGE),
}).strict()
const restart = z.object({
  name: z.string().min(1), id: hex, image: z.string().regex(IMAGE),
  before: z.string().min(1), after: z.string().min(1),
}).strict()
const rollback = z.object({
  name: z.string().min(1), id: hex, image: z.string().regex(IMAGE), original: z.string().min(1),
}).strict()
const evidence = z.object({
  id: z.string().min(1), root: z.enum(["source", "evidence"]),
  path: z.string().regex(SAFE_EVIDENCE_PATH), sha256: hex, bytes: z.number().int().nonnegative(),
}).strict()

function uniqueByCanonical<T>(schema: z.ZodType<T>, minimum: number, maximum: number) {
  return z.array(schema).min(minimum).max(maximum).superRefine((items, context) => {
    const values = items.map((item) => JSON.stringify(item))
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", message: "duplicate entries are forbidden" })
    }
  })
}

const receiptSchema = z.object({
  schemaVersion: z.literal(WACO_PRODUCT_TERMINAL_BINDING.schemaVersion),
  productId: z.literal(WACO_PRODUCT_TERMINAL_BINDING.productId),
  repository: z.literal(WACO_PRODUCT_TERMINAL_BINDING.repository),
  terminalState: z.literal(WACO_PRODUCT_TERMINAL_BINDING.terminalState),
  releaseId: z.literal(WACO_PRODUCT_TERMINAL_BINDING.releaseId),
  releaseSha: z.string().regex(SHA40),
  deploymentId: z.literal(WACO_PRODUCT_TERMINAL_BINDING.deploymentId),
  machine: z.literal(WACO_PRODUCT_TERMINAL_BINDING.machine),
  authority: z.object({
    surface: z.literal("terracanon"), mode: z.literal("local-maintenance"),
    profileId: z.literal(WACO_PRODUCT_TERMINAL_BINDING.profileId), profileSha256: hex,
  }).strict(),
  acceptedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  countyPackage: z.object({
    countyId: z.literal("b7c9fef3-cf48-45f4-967f-d3b9d265876d"),
    county: z.literal("Benton"), countyCode: z.literal("005"),
    classification: z.literal("COUNTY_DERIVED_CONFERENCE_SAFE_BOUNDED_READ_ONLY_NOT_DOR_CERTIFIED"),
    sales: z.literal(50), computableRatios: z.literal(0),
    manifestSha256: hex, salesSha256: hex, sourcePayloadSha256: hex,
  }).strict(),
  deployment: z.object({
    scope: z.string().min(1), containers: uniqueByCanonical(container, 6, 6),
    restart: uniqueByCanonical(restart, 4, 4), restorationProven: z.literal(true),
  }).strict(),
  assurance: z.object({
    executionVerdict: z.literal("INDEPENDENT_F_BOUNDED_EXECUTION_PASS"),
    sealVerdict: z.literal("SEAL_REVIEW_PASS"),
    originalSealStatus: z.literal("FINAL_RC_LOCAL_SEAL_PENDING_INDEPENDENT_F"),
    executionReviewSha256: hex, sealReviewSha256: hex,
  }).strict(),
  recovery: z.object({
    rollbackContainers: uniqueByCanonical(rollback, 3, 3),
    archive: z.object({
      sha256: hex, bytes: z.number().int().positive(), imageCount: z.literal(6),
      restoredFromArchive: z.literal(false),
    }).strict(),
    databaseBackup: z.literal(false), recoveryTested: z.literal(false),
  }).strict(),
  acceptanceEvidence: uniqueByCanonical(evidence, 16, 256),
  limitations: z.array(z.string().min(1)).min(8).max(64).superRefine((items, context) => {
    if (new Set(items).size !== items.length) context.addIssue({ code: "custom", message: "duplicate limitations are forbidden" })
  }),
  statewideLaunchComplete: z.literal(false),
  productionDeployed: z.literal(false),
  receiptId: z.string().regex(/^tf-product-terminal:[0-9a-f]{64}$/),
  contentSha256: hex,
}).strict()

const catalogArtifact = z.object({ path: z.string().min(1), sha256: hex }).strict()
const catalogRelease = z.object({
  releaseId: z.string().min(1), terminalState: z.string().min(1), releaseSha: z.string().regex(SHA40),
  deploymentId: z.string().min(1), receipt: catalogArtifact, profile: catalogArtifact,
}).strict()
const catalogSchema = z.object({
  schemaVersion: z.literal("terrafusion.product-terminal-catalog.v1"),
  productId: z.literal(WACO_PRODUCT_TERMINAL_BINDING.productId),
  repository: z.literal(WACO_PRODUCT_TERMINAL_BINDING.repository),
  releases: z.array(catalogRelease).min(1).max(128).superRefine((items, context) => {
    if (new Set(items.map((item) => item.releaseId)).size !== items.length) {
      context.addIssue({ code: "custom", message: "duplicate release IDs are forbidden" })
    }
  }),
}).strict()

const profileFile = evidence.extend({
  format: z.enum(["binary", "json", "text"]),
  legacyPath: z.string().min(1).optional(),
}).strict()
const profileSchema = z.object({
  schemaVersion: z.literal(1),
  profileId: z.literal(WACO_PRODUCT_TERMINAL_BINDING.profileId),
  productId: z.literal(WACO_PRODUCT_TERMINAL_BINDING.productId),
  repository: z.literal(WACO_PRODUCT_TERMINAL_BINDING.repository),
  releaseId: z.literal(WACO_PRODUCT_TERMINAL_BINDING.releaseId),
  terminalState: z.literal(WACO_PRODUCT_TERMINAL_BINDING.terminalState),
  deploymentId: z.literal(WACO_PRODUCT_TERMINAL_BINDING.deploymentId),
  releaseSha: z.literal(WACO_PRODUCT_TERMINAL_BINDING.releaseSha),
  machine: z.literal(WACO_PRODUCT_TERMINAL_BINDING.machine),
  acceptedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scope: z.string().min(1),
  countyId: z.literal("b7c9fef3-cf48-45f4-967f-d3b9d265876d"),
  county: z.literal("Benton"),
  countyCode: z.literal("005"),
  classification: z.literal("COUNTY_DERIVED_CONFERENCE_SAFE_BOUNDED_READ_ONLY_NOT_DOR_CERTIFIED"),
  containers: uniqueByCanonical(container, 6, 6),
  restart: uniqueByCanonical(restart, 4, 4),
  rollback: uniqueByCanonical(rollback, 3, 3),
  limitations: z.array(z.string().min(1)).min(8).max(64),
  files: uniqueByCanonical(profileFile, 16, 256),
}).strict()

export type ProductTerminalReceipt = z.infer<typeof receiptSchema>

export type ProtectedProductTerminalProof = Readonly<{
  protectedCommit: string
  catalogPath: typeof PRODUCT_TERMINAL_CATALOG_PATH
  catalogSha256: string
  receiptPath: string
  receiptSha256: string
  profilePath: string
  profileSha256: string
  receiptId: string
  contentSha256: string
  productId: string
  repository: string
  terminalState: string
  releaseId: string
  releaseSha: string
  deploymentId: string
  acceptedAt: string
  limitations: readonly string[]
}>

export type ProtectedProductTerminalLoaderDependencies = Readonly<{
  resolveProtectedMain: (workspaceRoot: string, repository: string) => Promise<string>
  readBlob: (workspaceRoot: string, commit: string, path: string) => Promise<Buffer>
}>

function invalid(code: "PRODUCT_TERMINAL_RECEIPT_INVALID" | "PRODUCT_TERMINAL_PROVENANCE_INVALID"): never {
  throw new Error(code)
}

function rawSha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function canonicalSet(values: readonly unknown[]): string {
  return JSON.stringify(values.map((value) => JSON.stringify(value)).sort())
}

function gitText(workspaceRoot: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile(
    "git", ["-C", workspaceRoot, ...args], { encoding: "utf8", windowsHide: true, maxBuffer: 1_000_000 },
    (error, stdout) => error ? reject(error) : resolve(stdout),
  ))
}

function gitBlob(workspaceRoot: string, commit: string, artifactPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => execFile(
    "git", ["-C", workspaceRoot, "show", `${commit}:${artifactPath}`],
    { encoding: "buffer", windowsHide: true, maxBuffer: 2_000_000 },
    (error, stdout) => error ? reject(error) : resolve(Buffer.from(stdout)),
  ))
}

const protectedLoaderDependencies: ProtectedProductTerminalLoaderDependencies = {
  async resolveProtectedMain(workspaceRoot, repository) {
    const remote = (await gitText(workspaceRoot, ["remote", "get-url", "origin"])).trim()
    if (normalizeRepositoryIdentity(remote) !== repository) invalid("PRODUCT_TERMINAL_PROVENANCE_INVALID")
    await gitText(workspaceRoot, ["fetch", "--no-tags", "--prune", "origin", "main"])
    const protectedTip = (await gitText(workspaceRoot, ["rev-parse", "refs/remotes/origin/main"])).trim()
    if (!SHA40.test(protectedTip)) invalid("PRODUCT_TERMINAL_PROVENANCE_INVALID")
    // Bind the proof to the immutable commit that published the catalog, not to the moving
    // protected-main tip. An unrelated later merge must not turn the same receipt into drift.
    const publicationCommit = (await gitText(workspaceRoot, [
      "log", "-1", "--format=%H", protectedTip, "--", PRODUCT_TERMINAL_CATALOG_PATH,
    ])).trim()
    if (!SHA40.test(publicationCommit)) invalid("PRODUCT_TERMINAL_PROVENANCE_INVALID")
    await gitText(workspaceRoot, ["merge-base", "--is-ancestor", publicationCommit, protectedTip])
    return publicationCommit
  },
  readBlob: gitBlob,
}

function boundedJson(bytes: Buffer, maximum: number): unknown {
  if (bytes.length === 0 || bytes.length > maximum) invalid("PRODUCT_TERMINAL_PROVENANCE_INVALID")
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    return invalid("PRODUCT_TERMINAL_PROVENANCE_INVALID")
  }
}

export function validateProductTerminalReceipt(value: unknown): ProductTerminalReceipt {
  const parsed = receiptSchema.safeParse(value)
  if (!parsed.success || parsed.data.releaseSha !== WACO_PRODUCT_TERMINAL_BINDING.releaseSha) {
    return invalid("PRODUCT_TERMINAL_RECEIPT_INVALID")
  }
  const { receiptId, contentSha256, ...content } = parsed.data
  const derived = hashRecord(content)
  if (derived !== contentSha256 || receiptId !== `tf-product-terminal:${derived}`) {
    return invalid("PRODUCT_TERMINAL_RECEIPT_INVALID")
  }
  return parsed.data
}

export function verifyProtectedProductTerminalArtifacts(input: Readonly<{
  protectedCommit: string
  catalogBytes: Buffer
  receiptBytes: Buffer
  profileBytes: Buffer
  expected?: typeof WACO_PRODUCT_TERMINAL_BINDING
}>): ProtectedProductTerminalProof {
  const expected = input.expected ?? WACO_PRODUCT_TERMINAL_BINDING
  if (!SHA40.test(input.protectedCommit)) invalid("PRODUCT_TERMINAL_PROVENANCE_INVALID")
  const catalog = catalogSchema.safeParse(boundedJson(input.catalogBytes, 256_000))
  if (!catalog.success) invalid("PRODUCT_TERMINAL_PROVENANCE_INVALID")
  const matches = catalog.data.releases.filter((entry) => entry.releaseId === expected.releaseId)
  if (matches.length !== 1) invalid("PRODUCT_TERMINAL_PROVENANCE_INVALID")
  const release = matches[0]
  if (catalog.data.productId !== expected.productId || catalog.data.repository !== expected.repository
    || release.terminalState !== expected.terminalState || release.releaseSha !== expected.releaseSha
    || release.deploymentId !== expected.deploymentId || release.receipt.path !== expected.receiptPath
    || release.profile.path !== expected.profilePath
    || rawSha256(input.receiptBytes) !== release.receipt.sha256
    || rawSha256(input.profileBytes) !== release.profile.sha256) {
    invalid("PRODUCT_TERMINAL_PROVENANCE_INVALID")
  }
  let receipt: ProductTerminalReceipt
  try {
    receipt = validateProductTerminalReceipt(boundedJson(input.receiptBytes, 1_000_000))
  } catch {
    return invalid("PRODUCT_TERMINAL_PROVENANCE_INVALID")
  }
  const profile = profileSchema.safeParse(boundedJson(input.profileBytes, 1_000_000))
  if (!profile.success) invalid("PRODUCT_TERMINAL_PROVENANCE_INVALID")
  const profileEvidence = profile.data.files.map(({ id, root, path, sha256, bytes }) => ({
    id, root, path, sha256, bytes,
  }))
  if (profile.data.acceptedAt !== receipt.acceptedAt
    || profile.data.scope !== receipt.deployment.scope
    || profile.data.countyId !== receipt.countyPackage.countyId
    || profile.data.county !== receipt.countyPackage.county
    || profile.data.countyCode !== receipt.countyPackage.countyCode
    || profile.data.classification !== receipt.countyPackage.classification
    || canonicalSet(profile.data.containers) !== canonicalSet(receipt.deployment.containers)
    || canonicalSet(profile.data.restart) !== canonicalSet(receipt.deployment.restart)
    || canonicalSet(profile.data.rollback) !== canonicalSet(receipt.recovery.rollbackContainers)
    || canonicalSet(profile.data.limitations) !== canonicalSet(receipt.limitations)
    || canonicalSet(profileEvidence) !== canonicalSet(receipt.acceptanceEvidence)
    || receipt.authority.profileSha256 !== release.profile.sha256
    || receipt.productId !== expected.productId || receipt.repository !== expected.repository
    || receipt.terminalState !== expected.terminalState || receipt.releaseId !== expected.releaseId
    || receipt.releaseSha !== expected.releaseSha || receipt.deploymentId !== expected.deploymentId
    || receipt.machine !== expected.machine) {
    invalid("PRODUCT_TERMINAL_PROVENANCE_INVALID")
  }
  return {
    protectedCommit: input.protectedCommit,
    catalogPath: PRODUCT_TERMINAL_CATALOG_PATH,
    catalogSha256: rawSha256(input.catalogBytes),
    receiptPath: release.receipt.path,
    receiptSha256: release.receipt.sha256,
    profilePath: release.profile.path,
    profileSha256: release.profile.sha256,
    receiptId: receipt.receiptId,
    contentSha256: receipt.contentSha256,
    productId: receipt.productId,
    repository: receipt.repository,
    terminalState: receipt.terminalState,
    releaseId: receipt.releaseId,
    releaseSha: receipt.releaseSha,
    deploymentId: receipt.deploymentId,
    acceptedAt: receipt.acceptedAt,
    limitations: [...receipt.limitations],
  }
}

export async function loadProtectedProductTerminalProof(
  input: Readonly<{ workspaceRoot: string; repository: string }>,
  dependencies: ProtectedProductTerminalLoaderDependencies = protectedLoaderDependencies,
): Promise<ProtectedProductTerminalProof> {
  if (input.repository !== WACO_PRODUCT_TERMINAL_BINDING.repository) {
    invalid("PRODUCT_TERMINAL_PROVENANCE_INVALID")
  }
  try {
    const protectedCommit = await dependencies.resolveProtectedMain(input.workspaceRoot, input.repository)
    if (!SHA40.test(protectedCommit)) invalid("PRODUCT_TERMINAL_PROVENANCE_INVALID")
    const catalogBytes = await dependencies.readBlob(
      input.workspaceRoot, protectedCommit, PRODUCT_TERMINAL_CATALOG_PATH,
    )
    const catalogValue = catalogSchema.safeParse(boundedJson(catalogBytes, 256_000))
    if (!catalogValue.success) invalid("PRODUCT_TERMINAL_PROVENANCE_INVALID")
    const releases = catalogValue.data.releases.filter(
      (entry) => entry.releaseId === WACO_PRODUCT_TERMINAL_BINDING.releaseId,
    )
    if (releases.length !== 1
      || releases[0].receipt.path !== WACO_PRODUCT_TERMINAL_BINDING.receiptPath
      || releases[0].profile.path !== WACO_PRODUCT_TERMINAL_BINDING.profilePath) {
      invalid("PRODUCT_TERMINAL_PROVENANCE_INVALID")
    }
    const [receiptBytes, profileBytes] = await Promise.all([
      dependencies.readBlob(input.workspaceRoot, protectedCommit, WACO_PRODUCT_TERMINAL_BINDING.receiptPath),
      dependencies.readBlob(input.workspaceRoot, protectedCommit, WACO_PRODUCT_TERMINAL_BINDING.profilePath),
    ])
    return verifyProtectedProductTerminalArtifacts({
      protectedCommit, catalogBytes, receiptBytes, profileBytes,
      expected: WACO_PRODUCT_TERMINAL_BINDING,
    })
  } catch (error) {
    if (error instanceof Error && error.message === "PRODUCT_TERMINAL_PROVENANCE_INVALID") throw error
    return invalid("PRODUCT_TERMINAL_PROVENANCE_INVALID")
  }
}
