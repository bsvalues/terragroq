import { generateKeyPairSync } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { createArtifactAdoptionRuntime, deriveArtifactAdoptionBaseSha } from "@/lib/governance/artifact-adoption-runtime"

const head = "2".repeat(40)
const base = "1".repeat(40)
const paths = ["app/a.ts", "lib/b.ts"]
const target = { pullRequest: 1117, expectedHeadSha: head } as const

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
  const artifactPaths = Array.isArray(row.allowedFiles)
    ? row.allowedFiles.filter((value): value is string => typeof value === "string")
    : paths
  const events: Array<{ type: string; entity: string; metadata: unknown }> = []
  const grants: Array<Record<string, unknown>> = []
  let expireGrantAtFence = false
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    if (sql.includes("FROM \"working_world\" world")) return { rows: [row] }
    if (sql.includes("FROM \"authority_grant\"") && !sql.includes("JOIN")) {
      const grant = grants.find((value) => Number(value.id) === Number(values?.[1]))
      return { rows: grant ? [grant] : [] }
    }
    if (sql.includes("entityType\"='williamos_delivery_seal'")) {
      const matching = events.filter((event) => {
        if (event.type !== "EVIDENCE_RECORDED") return false
        const metadata = event.metadata as Record<string, any>
        if (sql.includes("metadata\"->>'adoptionHash'=$2")) return metadata.adoptionHash === values?.[1]
        return metadata.seal?.payload?.adoption?.worldId === values?.[1]
      }).reverse()
      return { rows: matching.slice(0, sql.includes("LIMIT 2") ? 2 : 1).map((event) => ({ metadata: event.metadata })) }
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
    if (sql.includes("INSERT INTO \"authority_grant\"")) {
      const grant = {
        id: 44, ref: values?.[1], workOrderId: values?.[2], grantedBy: values?.[0], grantedTo: values?.[3],
        authorityLevel: "A8_PUSH", scope: values?.[4], allowedActions: values?.[5], blockedActions: values?.[6],
        status: "active", expiresAt: values?.[8], revokedAt: null, contentHash: values?.[9],
      }
      grants.push(grant)
      return { rows: [grant] }
    }
    if (sql.includes("FROM \"authority_grant\"") && sql.includes("FOR UPDATE")) {
      const grant = grants.find((value) => Number(value.id) === Number(values?.[1]))
      return { rows: grant ? [{ ...grant, ...(expireGrantAtFence ? { expiresAt: new Date("2026-08-31T19:59:59.000Z") } : {}) }] : [] }
    }
    if (sql.includes("FROM \"working_world\" world") && sql.includes("FOR UPDATE OF world")) return { rows: [row] }
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
    inspectPullRequest: vi.fn(async (_number: number, _options?: { allowRemediationBranch?: boolean }): Promise<Record<string, unknown>> => ({ number: 1117, state: "OPEN", headRefOid: head, isDraft: false, reviewDecision: "", checksGreen: true, checksComplete: true, reviewed: true, reviewCompleted: true, unresolvedThreadCount: 0 })),
    inspectPullRequestFiles: vi.fn(async (_number: number): Promise<readonly string[]> => artifactPaths),
  }
  const deriveBaseSha = vi.fn(async (_root: string, _repository: string, _pullRequest: number, _headSha: string) => ({ pullRequestBaseSha: "0".repeat(40), baseRefSha: base, mergeBaseSha: base }))
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const runtime = createArtifactAdoptionRuntime({
    database: db,
    workspaceExists: vi.fn(async () => true),
    createLifecycle: vi.fn(() => lifecycle),
    deriveBaseSha,
    inspectDelivery: vi.fn(async () => ({ repository: "https://github.com/bsvalues/terragroq", baseSha: base, commitSha: head, paths: artifactPaths, patchDigest: "d".repeat(64), contentDigest: "e".repeat(64) })),
    signingKey: { keyId: "test-key", privateKey, publicKey },
    now: () => new Date("2026-08-31T20:00:00.000Z"),
  })
  return { runtime, db, lifecycle, events, txQuery, deriveBaseSha, expireGrantAtFence: () => { expireGrantAtFence = true } }
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
  it("derives the target artifact from GitHub while requiring a valid persisted Space authority spine", async () => {
    const valid = harness()
    await expect(valid.runtime.preview("owner-1", "space-1", target)).resolves.toMatchObject({ pullRequest: 1117, headSha: head, paths })
    expect(valid.lifecycle.inspectPullRequest).toHaveBeenCalledWith(1117, { allowRemediationBranch: true })

    for (const bad of [["app/**"], ["app/a.ts", "app/a.ts"], ["../escape.ts"], ["app/"]]) {
      const invalid = harness(authorityRow({ allowedFiles: bad, grantAllowed: bad, admissionRequest: { worldId: "space-1", externalWorkOrder: { repository: "bsvalues/terragroq", reservedPaths: bad, pullRequest: { number: 1117, headSha: head } } } }))
      await expect(invalid.runtime.preview("owner-1", "space-1", target)).rejects.toMatchObject({ code: "DELIVERY_SEAL_ASSIGNMENT_STALE" })
      expect(invalid.lifecycle.inspectPullRequest).not.toHaveBeenCalled()
    }
    await expect(harness(authorityRow({ repository: "other/repo" })).runtime.preview("owner-1", "space-1", target))
      .rejects.toMatchObject({ code: "DELIVERY_SEAL_ASSIGNMENT_STALE" })
    await expect(harness(authorityRow({
      repository: "other/repo",
      admissionRequest: {
        worldId: "space-1",
        externalWorkOrder: { repository: "other/repo", reservedPaths: paths, pullRequest: { number: 1117, headSha: head } },
      },
    })).runtime.preview("owner-1", "space-1", target))
      .rejects.toMatchObject({ code: "DELIVERY_SEAL_ASSIGNMENT_STALE" })
  })

  it("accepts a canonical literal Next route path containing a dynamic segment", async () => {
    const dynamicRoutePaths = ["app/api/environment/spaces/[worldId]/route.ts"]
    const row = authorityRow({
      allowedFiles: dynamicRoutePaths,
      grantAllowed: dynamicRoutePaths,
      admissionRequest: {
        worldId: "space-1",
        externalWorkOrder: {
          repository: "bsvalues/terragroq",
          reservedPaths: dynamicRoutePaths,
          pullRequest: { number: 1117, headSha: head },
        },
      },
    })

    await expect(harness(row).runtime.preview("owner-1", "space-1", target)).resolves.toMatchObject({
      paths: dynamicRoutePaths,
    })
  })

  it("binds the preview to the Space repository and owner-confirmed exact PR head when resolving its base", async () => {
    const candidate = harness()
    await candidate.runtime.preview("owner-1", "space-1", target)
    const [workspace, repository, pullRequest, admittedHead] = candidate.deriveBaseSha.mock.calls[0]
    expect(workspace.replace(/\\/g, "/")).toMatch(/c:\/repo$/)
    expect([repository, pullRequest, admittedHead]).toEqual([
      "https://github.com/bsvalues/terragroq", 1117, head,
    ])
  })

  it("keeps the historical PR base distinct from the current base-ref tip and merge base", async () => {
    const candidate = harness()
    const preview = await candidate.runtime.preview("owner-1", "space-1", target)
    await candidate.runtime.authorize("owner-1", "space-1", target, "adopt:1117:moved-base", preview.previewDigest)
    candidate.deriveBaseSha.mockResolvedValue({
      pullRequestBaseSha: "0".repeat(40),
      baseRefSha: "3".repeat(40),
      mergeBaseSha: base,
    })
    await expect(candidate.runtime.issue("owner-1", "space-1", "adopt:1117:moved-base"))
      .rejects.toMatchObject({ code: "DELIVERY_SEAL_ASSIGNMENT_STALE" })
  })

  it("records prospective authorization before recording distinct exact-head validation and review evidence", async () => {
    const { runtime, lifecycle, events } = harness()
    const preview = await runtime.preview("owner-1", "space-1", target)
    const authorized = await runtime.authorize("owner-1", "space-1", target, "adopt:1117:exact", preview.previewDigest)
    expect(authorized.status).toBe("AUTHORIZED")
    expect(events.map((event) => event.type)).toEqual(["ARTIFACT_ADOPTION_AUTHORIZED"])
    expect(lifecycle.inspectPullRequest).toHaveBeenCalledTimes(2)

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
    await expect(runtime.preview("owner-1", "space-1")).resolves.toMatchObject({
      status: "SEALED",
      seal: sealed.seal,
      sealBlock: sealed.sealBlock,
    })
    expect(lifecycle.inspectPullRequest).toHaveBeenCalledTimes(6)

    const replayed = await runtime.issue("owner-1", "space-1", "adopt:1117:exact")
    expect(replayed.seal).toEqual(sealed.seal)
    expect(events.filter((event) => event.type === "ARTIFACT_ADOPTION_VALIDATED")).toHaveLength(2)
    expect(events.filter((event) => event.type === "ARTIFACT_ADOPTION_REVIEWED")).toHaveLength(2)
    expect(events.filter((event) => event.type === "EVIDENCE_RECORDED")).toHaveLength(1)
  })

  it("restores a persisted seal after merge without re-entering the open-PR issuance path", async () => {
    const candidate = harness()
    const preview = await candidate.runtime.preview("owner-1", "space-1", target)
    await candidate.runtime.authorize("owner-1", "space-1", target, "adopt:1117:restore-merged", preview.previewDigest)
    const sealed = await candidate.runtime.issue("owner-1", "space-1", "adopt:1117:restore-merged")
    const inspectedBeforeRestore = candidate.lifecycle.inspectPullRequest.mock.calls.length
    candidate.lifecycle.inspectPullRequest.mockRejectedValue(new Error("merged pull requests cannot enter prospective issuance"))

    await expect(candidate.runtime.preview("owner-1", "space-1")).resolves.toMatchObject({
      status: "SEALED",
      worldId: "space-1",
      pullRequest: 1117,
      headSha: head,
      paths,
      adoptionHash: sealed.adoptionHash,
      seal: sealed.seal,
      sealBlock: sealed.sealBlock,
    })
    expect(candidate.lifecycle.inspectPullRequest).toHaveBeenCalledTimes(inspectedBeforeRestore)
    expect(candidate.events.filter((event) => event.type === "EVIDENCE_RECORDED")).toHaveLength(1)
  })

  it("restores only the latest exact adoption when a Space has historical delivery seals", async () => {
    const candidate = harness()
    candidate.events.push({
      type: "EVIDENCE_RECORDED",
      entity: "williamos_delivery_seal",
      metadata: {
        adoptionHash: "9".repeat(64),
        authorizationEventId: 91,
        seal: { payload: { adoption: { worldId: "space-1" } }, signature: "historical" },
      },
    })
    const preview = await candidate.runtime.preview("owner-1", "space-1", target)
    await candidate.runtime.authorize("owner-1", "space-1", target, "adopt:1117:latest-space-seal", preview.previewDigest)
    const latest = await candidate.runtime.issue("owner-1", "space-1", "adopt:1117:latest-space-seal")
    candidate.lifecycle.inspectPullRequest.mockRejectedValue(new Error("merged pull requests cannot enter prospective issuance"))

    await expect(candidate.runtime.preview("owner-1", "space-1")).resolves.toMatchObject({
      status: "SEALED",
      adoptionHash: latest.adoptionHash,
      seal: latest.seal,
    })
    expect(candidate.events.filter((event) => event.type === "EVIDENCE_RECORDED")).toHaveLength(2)
  })

  it("permits a legitimate non-expiring Space grant to authorize and issue", async () => {
    const candidate = harness(authorityRow({ grantExpiresAt: null }))
    const preview = await candidate.runtime.preview("owner-1", "space-1", target)
    await candidate.runtime.authorize("owner-1", "space-1", target, "adopt:1117:no-expiry", preview.previewDigest)
    await expect(candidate.runtime.issue("owner-1", "space-1", "adopt:1117:no-expiry"))
      .resolves.toMatchObject({ status: "SEALED" })
  })

  it("permits only the exact self-referential delivery check before sealing", async () => {
    const candidate = harness()
    const preview = await candidate.runtime.preview("owner-1", "space-1", target)
    await candidate.runtime.authorize("owner-1", "space-1", target, "adopt:1117:self-seal", preview.previewDigest)
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
    const preview = await candidate.runtime.preview("owner-1", "space-1", target)
    await candidate.runtime.authorize("owner-1", "space-1", target, `adopt:1117:${_label}`, preview.previewDigest)
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
    const preview = await candidate.runtime.preview("owner-1", "space-1", target)
    await candidate.runtime.authorize("owner-1", "space-1", target, "adopt:1117:closed", preview.previewDigest)
    candidate.lifecycle.inspectPullRequest.mockResolvedValue({
      number: 1117, state: "CLOSED", headRefOid: head,
      isDraft: false, reviewDecision: "", checksGreen: true, checksComplete: true, reviewed: true, reviewCompleted: true, unresolvedThreadCount: 0,
    })
    await expect(candidate.runtime.issue("owner-1", "space-1", "adopt:1117:closed"))
      .rejects.toMatchObject({ code: "DELIVERY_SEAL_EVIDENCE_INVALID" })
  })

  it.each([
    ["draft", { isDraft: true, reviewDecision: "" }],
    ["changes requested", { isDraft: false, reviewDecision: "CHANGES_REQUESTED" }],
  ])("fails closed when the trusted pull request is %s", async (_label, reviewState) => {
    const candidate = harness()
    const preview = await candidate.runtime.preview("owner-1", "space-1", target)
    await candidate.runtime.authorize("owner-1", "space-1", target, `adopt:1117:${_label}`, preview.previewDigest)
    candidate.lifecycle.inspectPullRequest.mockResolvedValue({
      number: 1117, state: "OPEN", headRefOid: head, checksGreen: true, checksComplete: true,
      reviewed: true, reviewCompleted: true, unresolvedThreadCount: 0, ...reviewState,
    })
    await expect(candidate.runtime.issue("owner-1", "space-1", `adopt:1117:${_label}`))
      .rejects.toMatchObject({ code: "DELIVERY_SEAL_EVIDENCE_INVALID" })
  })

  it("final fence rolls back when persisted authority or exact evidence no longer matches", async () => {
    const { runtime, txQuery } = harness()
    const preview = await runtime.preview("owner-1", "space-1", target)
    await runtime.authorize("owner-1", "space-1", target, "adopt:1117:exact", preview.previewDigest)
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
    const preview = await runtime.preview("owner-1", "space-1", target)
    await runtime.authorize("owner-1", "space-1", target, "adopt:1117:exact", preview.previewDigest)
    await runtime.issue("owner-1", "space-1", "adopt:1117:exact")
    const sql = String(txQuery.mock.calls.find(([statement]) => String(statement).includes("FOR UPDATE OF authorization_event"))?.[0] ?? "")
    expect(sql).toContain('authorization_event."metadata" AS "authorizationMetadata"')
    expect(sql).toContain('validation_event."metadata" AS "validationMetadata"')
    expect(sql).toContain('review_event."metadata" AS "reviewMetadata"')
  })

  it("rechecks the delivery grant expiry inside the final serializable fence", async () => {
    const candidate = harness()
    const preview = await candidate.runtime.preview("owner-1", "space-1", target)
    await candidate.runtime.authorize("owner-1", "space-1", target, "adopt:1117:expiry-fence", preview.previewDigest)
    candidate.expireGrantAtFence()

    await expect(candidate.runtime.issue("owner-1", "space-1", "adopt:1117:expiry-fence"))
      .rejects.toMatchObject({ code: "DELIVERY_SEAL_ASSIGNMENT_STALE" })
    const grantFence = String(candidate.txQuery.mock.calls.find(([statement]) => String(statement).includes('FROM "authority_grant"') && String(statement).includes("FOR UPDATE"))?.[0] ?? "")
    expect(grantFence).toContain('"expiresAt" > CURRENT_TIMESTAMP')
  })
})
