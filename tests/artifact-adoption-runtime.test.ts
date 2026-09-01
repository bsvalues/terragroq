import { generateKeyPairSync } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { createArtifactAdoptionRuntime, deriveArtifactAdoptionBaseSha } from "@/lib/governance/artifact-adoption-runtime"

const head = "2".repeat(40)
const base = "1".repeat(40)
const paths = ["app/a.ts", "lib/b.ts"]

function authorityRow(overrides: Record<string, unknown> = {}) {
  return {
    worldSnapshot: JSON.stringify({
      schemaVersion: 1,
      spine: { projectId: 9, projectName: "WilliamOS", threadId: "thread-1", outcomeKey: "EXPERIENCE_V2", outcomeTitle: "Experience V2", workOrderId: 22, execution: "authorized", worker: null, evidence: [] },
      intent: "Finish Experience V2", assumption: null,
      resources: ["williamos-workspace-root:v1:c:/repo"], branchHeads: {}, artifacts: [], agentWork: [], surfaces: [], openConcerns: [], unresolvedFailures: [], pendingDecisions: [], lastGreenValidation: null, lastRedValidation: null, conversation: [], councilHistory: [],
      judgment: null, continuation: "active", pendingStartWork: null,
      space: { schemaVersion: 1, revision: 9, windows: [], openFiles: [], panes: [], selection: null, activeWindowId: null, activePaneId: null, runningAppUrl: null },
    }),
    outcomeId: 11, outcomeKey: "EXPERIENCE_V2", outcomeVersion: 4, outcomeState: "active", activeWorkOrderId: 22,
    workOrderId: 22, workOrderRef: "WO-22", workOrderStatus: "active", workOrderVersion: new Date("2026-08-31T19:00:00.000Z"),
    workOrderGrantId: 33, workOrderAgent: "codex", allowedFiles: paths, forbiddenFiles: ["terrafusion/**"],
    grantId: 33, grantRef: "GRANT-33", grantWorkOrderId: 22, grantTo: "codex", grantStatus: "active", grantRevokedAt: null,
    grantExpiresAt: new Date("2026-09-01T00:00:00.000Z"), grantVersion: "grant-v1", grantCreatedAt: new Date("2026-08-31T19:00:00.000Z"),
    grantAllowed: paths, grantBlocked: ["terrafusion/**"], repository: "bsvalues/terragroq",
    admissionRequest: {
      worldId: "space-1",
      externalWorkOrder: {
        repository: "bsvalues/terragroq", reservedPaths: paths,
        pullRequest: { number: 1117, headSha: head },
      },
    },
    ...overrides,
  }
}

function harness(row = authorityRow()) {
  const events: Array<{ type: string; entity: string; metadata: unknown }> = []
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    if (sql.includes("FROM \"working_world\" world")) return { rows: [row] }
    if (sql.includes("entityType\"='williamos_delivery_seal'")) {
      const sealed = events.find((event) => event.type === "EVIDENCE_RECORDED")
      return { rows: sealed ? [{ metadata: sealed.metadata }] : [] }
    }
    if (sql.includes("FROM \"governance_event\"") && sql.includes("ARTIFACT_ADOPTION_AUTHORIZED")) {
      const match = events.find((event) => event.type === "ARTIFACT_ADOPTION_AUTHORIZED")
      return { rows: match ? [{ id: 101, metadata: match.metadata }] : [] }
    }
    if (sql.includes("FROM \"governance_event\"") && sql.includes("ARTIFACT_ADOPTION_VALIDATED")) {
      const validation = events.find((event) => event.type === "ARTIFACT_ADOPTION_VALIDATED")
      const review = events.find((event) => event.type === "ARTIFACT_ADOPTION_REVIEWED")
      return { rows: validation && review ? [{ validationEventId: 102, validationMetadata: validation.metadata, reviewEventId: 103, reviewMetadata: review.metadata }] : [] }
    }
    if (sql.includes("INSERT INTO \"governance_event\"")) {
      const type = String(values?.[1])
      const entity = String(values?.[2])
      const metadata = JSON.parse(String(values?.[5]))
      events.push({ type, entity, metadata })
      return { rows: [{ id: 100 + events.length }] }
    }
    return { rows: [] }
  })
  const txQuery = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    if (sql.startsWith("BEGIN") || sql === "COMMIT" || sql === "ROLLBACK" || sql.includes("pg_advisory_xact_lock")) return { rows: [] }
    if (sql.includes("FOR UPDATE OF authorization_event")) {
      const authorization = events.find((event) => event.type === "ARTIFACT_ADOPTION_AUTHORIZED")?.metadata
      const validation = events.find((event) => event.type === "ARTIFACT_ADOPTION_VALIDATED")?.metadata
      const review = events.find((event) => event.type === "ARTIFACT_ADOPTION_REVIEWED")?.metadata
      return { rows: authorization && validation && review ? [{ ...row, authorizationMetadata: authorization, validationMetadata: validation, reviewMetadata: review }] : [] }
    }
    if (sql.includes("ARTIFACT_ADOPTION_AUTHORIZED") && sql.includes("FOR UPDATE")) return { rows: [] }
    if (sql.includes("INSERT INTO \"governance_event\"")) {
      if (sql.includes("williamos_delivery_seal")) {
        events.push({ type: "EVIDENCE_RECORDED", entity: "williamos_delivery_seal", metadata: JSON.parse(String(values?.[2])) })
        return { rows: [{ id: 104 }] }
      }
      if (values?.[1] === "ARTIFACT_ADOPTION_AUTHORIZED") events.push({ type: String(values[1]), entity: String(values[2]), metadata: JSON.parse(String(values[5])) })
      return { rows: [{ id: values?.[1] === "ARTIFACT_ADOPTION_AUTHORIZED" ? 101 : 104 }] }
    }
    return { rows: [] }
  })
  const db = { query, connect: vi.fn(async () => ({ query: txQuery, release: vi.fn() })) }
  const lifecycle = {
    inspectPullRequest: vi.fn(async () => ({ number: 1117, state: "OPEN", headRefOid: head, isDraft: false, reviewDecision: "", checksGreen: true, checksComplete: true, reviewed: true, reviewCompleted: true, unresolvedThreadCount: 0 })),
    inspectPullRequestFiles: vi.fn(async () => paths),
  }
  const deriveBaseSha = vi.fn(async () => ({ pullRequestBaseSha: "0".repeat(40), baseRefSha: base, mergeBaseSha: base }))
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const runtime = createArtifactAdoptionRuntime({
    database: db,
    workspaceExists: vi.fn(async () => true),
    createLifecycle: vi.fn(() => lifecycle),
    deriveBaseSha,
    inspectDelivery: vi.fn(async () => ({ repository: "https://github.com/bsvalues/terragroq", baseSha: base, commitSha: head, paths, patchDigest: "d".repeat(64), contentDigest: "e".repeat(64) })),
    signingKey: { keyId: "test-key", privateKey, publicKey },
    now: () => new Date("2026-08-31T20:00:00.000Z"),
  })
  return { runtime, db, lifecycle, events, txQuery, deriveBaseSha }
}

describe("persisted prospective artifact adoption", () => {
  it("fetches and verifies the exact admitted PR head before deriving its merge base", async () => {
    const execute = vi.fn(async (_executable: string, args: readonly string[]) => {
      if (args[0] === "pr") return { stdout: JSON.stringify({ number: 1117, state: "OPEN", headRefOid: head, baseRefOid: "0".repeat(40), baseRefName: "main" }) }
      if (args.includes("refs/williamos/artifact-adoption/pr-1117-head^{commit}")) return { stdout: `${head}\n` }
      if (args.includes("refs/remotes/origin/main^{commit}")) return { stdout: `${base}\n` }
      if (args.includes("merge-base")) return { stdout: `${base}\n` }
      return { stdout: "" }
    })
    await expect(deriveArtifactAdoptionBaseSha("C:/repo", "https://github.com/bsvalues/terragroq", 1117, head, execute))
      .resolves.toEqual({ pullRequestBaseSha: "0".repeat(40), baseRefSha: base, mergeBaseSha: base })
    expect(execute).toHaveBeenCalledWith("git", ["-C", "C:/repo", "fetch", "--quiet", "origin",
      "+refs/pull/1117/head:refs/williamos/artifact-adoption/pr-1117-head"], { windowsHide: true })
    expect(execute.mock.calls.find(([, args]) => args.includes("merge-base"))?.[1]).toContain(head)
  })

  it("fails closed when the fetched PR ref no longer equals the admitted head", async () => {
    const execute = vi.fn(async (_executable: string, args: readonly string[]) => {
      if (args[0] === "pr") return { stdout: JSON.stringify({ number: 1117, state: "OPEN", headRefOid: head, baseRefOid: "0".repeat(40), baseRefName: "main" }) }
      if (args.includes("refs/williamos/artifact-adoption/pr-1117-head^{commit}")) return { stdout: `${"9".repeat(40)}\n` }
      return { stdout: "" }
    })
    await expect(deriveArtifactAdoptionBaseSha("C:/repo", "https://github.com/bsvalues/terragroq", 1117, head, execute))
      .rejects.toMatchObject({ code: "DELIVERY_SEAL_DIFF_INVALID" })
    expect(execute.mock.calls.some(([, args]) => args.includes("merge-base"))).toBe(false)
  })
  it("derives exact artifact authority from the persisted Space admission and rejects malformed reservations before GitHub", async () => {
    const valid = harness()
    await expect(valid.runtime.preview("owner-1", "space-1")).resolves.toMatchObject({ pullRequest: 1117, headSha: head, paths })
    expect(valid.lifecycle.inspectPullRequest).not.toHaveBeenCalled()

    for (const bad of [["app/**"], ["app/a.ts", "app/a.ts"], ["../escape.ts"], ["app/"]]) {
      const invalid = harness(authorityRow({ allowedFiles: bad, grantAllowed: bad, admissionRequest: { worldId: "space-1", externalWorkOrder: { repository: "bsvalues/terragroq", reservedPaths: bad, pullRequest: { number: 1117, headSha: head } } } }))
      await expect(invalid.runtime.preview("owner-1", "space-1")).rejects.toMatchObject({ code: "DELIVERY_SEAL_ASSIGNMENT_STALE" })
      expect(invalid.lifecycle.inspectPullRequest).not.toHaveBeenCalled()
    }
    await expect(harness(authorityRow({ repository: "other/repo" })).runtime.preview("owner-1", "space-1"))
      .rejects.toMatchObject({ code: "DELIVERY_SEAL_ASSIGNMENT_STALE" })
    await expect(harness(authorityRow({
      repository: "other/repo",
      admissionRequest: {
        worldId: "space-1",
        externalWorkOrder: { repository: "other/repo", reservedPaths: paths, pullRequest: { number: 1117, headSha: head } },
      },
    })).runtime.preview("owner-1", "space-1"))
      .rejects.toMatchObject({ code: "DELIVERY_SEAL_ASSIGNMENT_STALE" })
  })

  it("binds the preview to the admitted repository, pull request, and exact head when resolving its base", async () => {
    const candidate = harness()
    await candidate.runtime.preview("owner-1", "space-1")
    const [workspace, repository, pullRequest, admittedHead] = candidate.deriveBaseSha.mock.calls[0]
    expect(workspace.replace(/\\/g, "/")).toMatch(/c:\/repo$/)
    expect([repository, pullRequest, admittedHead]).toEqual([
      "https://github.com/bsvalues/terragroq", 1117, head,
    ])
  })

  it("keeps the historical PR base distinct from the current base-ref tip and merge base", async () => {
    const candidate = harness()
    const preview = await candidate.runtime.preview("owner-1", "space-1")
    await candidate.runtime.authorize("owner-1", "space-1", "adopt:1117:moved-base", preview.previewDigest)
    candidate.deriveBaseSha.mockResolvedValue({
      pullRequestBaseSha: "0".repeat(40),
      baseRefSha: "3".repeat(40),
      mergeBaseSha: base,
    })
    await expect(candidate.runtime.issue("owner-1", "space-1", "adopt:1117:moved-base"))
      .rejects.toMatchObject({ code: "DELIVERY_SEAL_ASSIGNMENT_STALE" })
  })

  it("records authorization before inspecting GitHub, then records distinct exact-head validation and review events", async () => {
    const { runtime, lifecycle, events } = harness()
    const preview = await runtime.preview("owner-1", "space-1")
    const authorized = await runtime.authorize("owner-1", "space-1", "adopt:1117:exact", preview.previewDigest)
    expect(authorized.status).toBe("AUTHORIZED")
    expect(events.map((event) => event.type)).toEqual(["ARTIFACT_ADOPTION_AUTHORIZED"])
    expect(lifecycle.inspectPullRequest).not.toHaveBeenCalled()

    await expect(runtime.preview("owner-1", "space-1")).resolves.toMatchObject({ status: "AUTHORIZED", previewDigest: preview.previewDigest, idempotencyKey: "adopt:1117:exact", authorizationEventId: 101 })
    const sealed = await runtime.issue("owner-1", "space-1", "adopt:1117:exact")
    expect(sealed.status).toBe("SEALED")
    expect(events.map((event) => event.type)).toEqual([
      "ARTIFACT_ADOPTION_AUTHORIZED", "ARTIFACT_ADOPTION_VALIDATED", "ARTIFACT_ADOPTION_REVIEWED",
      "ARTIFACT_ADOPTION_VALIDATED", "ARTIFACT_ADOPTION_REVIEWED",
      "EVIDENCE_RECORDED",
    ])
    expect(lifecycle.inspectPullRequest).toHaveBeenCalledWith(1117, { allowRemediationBranch: true })
    expect(sealed.seal.payload).toMatchObject({ version: "williamos-delivery-seal.v2", delivery: { commitSha: head, paths } })
    expect(sealed.sealBlock).toBe(["```WILLIAMOS_DELIVERY_SEAL", JSON.stringify(sealed.seal, null, 2), "```"].join("\n"))
    expect(lifecycle.inspectPullRequest).toHaveBeenCalledTimes(2)

    const replayed = await runtime.issue("owner-1", "space-1", "adopt:1117:exact")
    expect(replayed.seal).toEqual(sealed.seal)
    expect(events.filter((event) => event.type === "ARTIFACT_ADOPTION_VALIDATED")).toHaveLength(2)
    expect(events.filter((event) => event.type === "ARTIFACT_ADOPTION_REVIEWED")).toHaveLength(2)
    expect(events.filter((event) => event.type === "EVIDENCE_RECORDED")).toHaveLength(1)
  })

  it("permits only the exact self-referential delivery check before sealing", async () => {
    const candidate = harness()
    const preview = await candidate.runtime.preview("owner-1", "space-1")
    await candidate.runtime.authorize("owner-1", "space-1", "adopt:1117:self-seal", preview.previewDigest)
    candidate.lifecycle.inspectPullRequest.mockResolvedValue({
      number: 1117, state: "OPEN", headRefOid: head, isDraft: false, reviewDecision: "",
      checksGreen: false, checksComplete: true,
      failedChecks: [{ name: "WilliamOS assignment delivery seal", state: "FAILURE" }],
      pendingChecks: [], reviewed: true, reviewCompleted: true, unresolvedThreadCount: 0,
    })
    await expect(candidate.runtime.issue("owner-1", "space-1", "adopt:1117:self-seal"))
      .resolves.toMatchObject({ status: "SEALED" })
  })

  it.each([
    ["another failed check", [{ name: "WilliamOS assignment delivery seal", state: "FAILURE" }, { name: "vitest", state: "FAILURE" }], []],
    ["another pending check", [{ name: "WilliamOS assignment delivery seal", state: "FAILURE" }], [{ name: "production build", state: "IN_PROGRESS" }]],
    ["no observed checks", [], []],
  ])("fails closed with %s while the delivery check is unsealed", async (_label, failedChecks, pendingChecks) => {
    const candidate = harness()
    const preview = await candidate.runtime.preview("owner-1", "space-1")
    await candidate.runtime.authorize("owner-1", "space-1", `adopt:1117:${_label}`, preview.previewDigest)
    candidate.lifecycle.inspectPullRequest.mockResolvedValue({
      number: 1117, state: "OPEN", headRefOid: head, isDraft: false, reviewDecision: "",
      checksGreen: false, checksComplete: pendingChecks.length === 0,
      failedChecks, pendingChecks, reviewed: true, reviewCompleted: true, unresolvedThreadCount: 0,
    })
    await expect(candidate.runtime.issue("owner-1", "space-1", `adopt:1117:${_label}`))
      .rejects.toMatchObject({ code: "DELIVERY_SEAL_EVIDENCE_INVALID" })
  })

  it("fails closed when the trusted pull request is no longer open", async () => {
    const candidate = harness()
    const preview = await candidate.runtime.preview("owner-1", "space-1")
    await candidate.runtime.authorize("owner-1", "space-1", "adopt:1117:closed", preview.previewDigest)
    candidate.lifecycle.inspectPullRequest.mockResolvedValue({
      number: 1117, state: "CLOSED", headRefOid: head,
      checksGreen: true, checksComplete: true, reviewed: true, reviewCompleted: true, unresolvedThreadCount: 0,
    })
    await expect(candidate.runtime.issue("owner-1", "space-1", "adopt:1117:closed"))
      .rejects.toMatchObject({ code: "DELIVERY_SEAL_EVIDENCE_INVALID" })
  })

  it.each([
    ["draft", { isDraft: true, reviewDecision: "" }],
    ["changes requested", { isDraft: false, reviewDecision: "CHANGES_REQUESTED" }],
  ])("fails closed when the trusted pull request is %s", async (_label, reviewState) => {
    const candidate = harness()
    const preview = await candidate.runtime.preview("owner-1", "space-1")
    await candidate.runtime.authorize("owner-1", "space-1", `adopt:1117:${_label}`, preview.previewDigest)
    candidate.lifecycle.inspectPullRequest.mockResolvedValue({
      number: 1117, state: "OPEN", headRefOid: head, checksGreen: true, checksComplete: true,
      reviewed: true, reviewCompleted: true, unresolvedThreadCount: 0, ...reviewState,
    })
    await expect(candidate.runtime.issue("owner-1", "space-1", `adopt:1117:${_label}`))
      .rejects.toMatchObject({ code: "DELIVERY_SEAL_EVIDENCE_INVALID" })
  })

  it("final fence rolls back when persisted authority or exact evidence no longer matches", async () => {
    const { runtime, txQuery } = harness()
    const preview = await runtime.preview("owner-1", "space-1")
    await runtime.authorize("owner-1", "space-1", "adopt:1117:exact", preview.previewDigest)
    txQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith("BEGIN") || sql === "ROLLBACK") return { rows: [] }
      if (sql.includes("FOR UPDATE OF authorization_event")) return { rows: [] }
      return { rows: [] }
    })
    await expect(runtime.issue("owner-1", "space-1", "adopt:1117:exact"))
      .rejects.toMatchObject({ code: "DELIVERY_SEAL_ASSIGNMENT_STALE" })
    expect(txQuery).toHaveBeenCalledWith("ROLLBACK")
  })

  it("selects all locked event metadata explicitly in the final serializable fence", async () => {
    const { runtime, txQuery } = harness()
    const preview = await runtime.preview("owner-1", "space-1")
    await runtime.authorize("owner-1", "space-1", "adopt:1117:exact", preview.previewDigest)
    await runtime.issue("owner-1", "space-1", "adopt:1117:exact")
    const sql = String(txQuery.mock.calls.find(([statement]) => String(statement).includes("FOR UPDATE OF authorization_event"))?.[0] ?? "")
    expect(sql).toContain('authorization_event."metadata" AS "authorizationMetadata"')
    expect(sql).toContain('validation_event."metadata" AS "validationMetadata"')
    expect(sql).toContain('review_event."metadata" AS "reviewMetadata"')
  })
})
