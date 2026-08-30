import { readFileSync } from "node:fs"
import type { SQL } from "drizzle-orm"
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core"
import { describe, expect, it } from "vitest"

import { document } from "@/lib/db/schema"
import {
  assertGenericDocumentDeletionAllowed,
  assertHistoricalProjectContextReplay,
  buildHistoricalProjectContextArchiveUpdate,
  buildHistoricalProjectContextInsert,
  getHistoricalProjectContextCatalog,
} from "@/lib/history/historical-project-context"

describe("historical private Project/Thread context", () => {
  const identities = [
    {
      candidateId: "HKR-eabf2e0c67a8a0f4",
      claimId: "HKR004-C029",
      rawSha256: "e48c899f0451267a595f383da66fcce1412fd03b0bea46161222b87fbddf6aec",
      blobId: "22b22c9be307b13a7a89d74b2c78a65f72cd72b5",
      targetProjectKey: "terrafusion",
      content: "Professional inquiry should unite defensible reasoning, persuasive communication, quantitative practice, and explanatory narrative.",
    },
    {
      candidateId: "HKR-f2ae70ee3f7b4bda",
      claimId: "HKR004-C030",
      rawSha256: "a978afe01df7aff2bd37d59be9e739dc606dd39d96d35cb06f78eba21865cccd",
      blobId: "f1350719730e8f7dd6176fba8c5d8221f404cb51",
      targetProjectKey: "terrafusion",
      content: "Public confidence depends on reducing operational friction and presenting evidence whose quality can be examined.",
    },
    {
      candidateId: "HKR-0cd458c5fd967816",
      claimId: "HKR004-C031",
      rawSha256: "72133eae13c712f7527e6e729907ac868972471fed4ac15d07f28fd9fe416ecb",
      blobId: "8ff2013f573555997beb6aeece4369dece00a669",
      targetProjectKey: "williamos",
      content: "Use AI and other tools to deepen teachable understanding, not to replace examination of the underlying reasoning.",
    },
    {
      candidateId: "HKR-ae689745256df0d2",
      claimId: "HKR004-C019",
      rawSha256: "465b6d49a039bcfbd88a65dff5e8228228d44753b1655000785e920c8677a46b",
      blobId: "d7be14c0b244641e9b35fda7d32f6a224c3c97ab",
      targetProjectKey: "terrafusion",
      content: "Professional practice should connect public explanation and deliberate strategy in ways that earn and preserve trust.",
    },
    {
      candidateId: "HKR-c823a84feb4a7e52",
      claimId: "HKR004-C032",
      rawSha256: "c0abbb79a062a7a77f99c2604512a4edfd922dc1f0e2fa9079e8f9d5304fcabf",
      blobId: "33e38ed61972a8f999c1740cf002e8d62c585da7",
      targetProjectKey: "terrafusion",
      content: "Durable differentiation comes from domain knowledge, disciplined workflow, and public trust rather than tool novelty alone.",
    },
    {
      candidateId: "HKR-31831586c5a2811b",
      claimId: "HKR004-C020",
      rawSha256: "2c9f6dc7ce58c03114b84b97ca368a691a6caf7d11f65c5e321979970f5db0b5",
      blobId: "d1113123c9331d6693ddd437fada53cd57272604",
      targetProjectKey: "williamos",
      content: "Cross-domain inquiry should use privacy-safe prompts that invite comparison without exposing private source material.",
    },
  ] as const

  it("exposes only the six approved adapted records with exact provenance and Project mapping", () => {
    const catalog = getHistoricalProjectContextCatalog()

    expect(catalog.map((candidate) => ({
      candidateId: candidate.candidateId,
      claimId: candidate.claimId,
      rawSha256: candidate.provenance.rawSha256,
      blobId: candidate.provenance.blobId,
      targetProjectKey: candidate.targetProjectKey,
      content: candidate.content,
    }))).toEqual(identities)
    expect(catalog.map((candidate) => candidate.provenance)).toEqual(
      identities.map((identity) => ({
        sourceCommit: "7664e589bddbe35ea4b9f8b72fad2cfbb9ffe7f7",
        sourceTree: "de4bdd48108d12c35ea3f53e3f8b7d032cf2b674",
        provenanceCommits: [
          "d45981428d30b1c35714ea12b886720deb766419",
          "a1a9cc2d7f37b4311aea698a86314c27f85e340e",
        ],
        rawSha256: identity.rawSha256,
        blobId: identity.blobId,
        disposition: "PROMOTE_AS_PROPOSED",
        privacy: "private",
        authority: "historical_non_authoritative",
        executionMode: "non_executing",
      })),
    )
  })

  it("builds non-indexed Project-bound rows with no chunk or embedding surface", () => {
    const candidate = getHistoricalProjectContextCatalog()[0]

    expect(buildHistoricalProjectContextInsert("tenant-a", 41, candidate, null)).toMatchObject({
      userId: "tenant-a",
      projectId: 41,
      threadId: null,
      historicalCandidateId: candidate.candidateId,
      historicalClaimId: candidate.claimId,
      chunkCount: 0,
      status: "private_project_context",
      privacy: "private",
      authority: "historical_non_authoritative",
      executionMode: "non_executing",
      archivedAt: null,
    })
    expect(buildHistoricalProjectContextInsert("tenant-a", 41, candidate, "thread-7"))
      .toMatchObject({ projectId: 41, threadId: "thread-7", chunkCount: 0 })
  })

  it("accepts exact active or archived replay and rejects content, provenance, Project, and Thread collisions", () => {
    const candidate = getHistoricalProjectContextCatalog()[0]
    const exact = buildHistoricalProjectContextInsert("tenant-a", 41, candidate, null)

    expect(assertHistoricalProjectContextReplay(exact, candidate, {
      userId: "tenant-a",
      projectId: 41,
      threadId: null,
    })).toBe(exact)
    for (const collision of [
      { ...exact, content: "Different adapted content" },
      { ...exact, historicalProvenance: { ...candidate.provenance, sourceTree: "different" } },
      { ...exact, historicalProvenance: { ...candidate.provenance, rawPrivateBody: "forbidden" } },
      { ...exact, projectId: 42 },
      { ...exact, threadId: "different-thread" },
      { ...exact, chunkCount: 1 },
      { ...exact, status: "indexed" },
      { ...exact, privacy: "public" },
      { ...exact, authority: "binding" },
      { ...exact, executionMode: "executing" },
    ]) {
      expect(() => assertHistoricalProjectContextReplay(collision, candidate, {
        userId: "tenant-a",
        projectId: 41,
        threadId: null,
      })).toThrow(`HISTORICAL_PROJECT_CONTEXT_COLLISION:${candidate.candidateId}`)
    }
  })

  it("archives explicitly, repeats archive as a no-op, and refuses generic deletion", () => {
    const candidate = getHistoricalProjectContextCatalog()[1]
    const row = buildHistoricalProjectContextInsert("tenant-a", 7, candidate, null)
    const archivedAt = new Date("2026-08-30T12:00:00.000Z")

    expect(buildHistoricalProjectContextArchiveUpdate(row, archivedAt)).toEqual({
      status: "archived_private_project_context",
      archivedAt,
    })
    expect(buildHistoricalProjectContextArchiveUpdate({
      ...row,
      status: "archived_private_project_context",
      archivedAt,
    }, archivedAt)).toBeNull()
    expect(() => assertGenericDocumentDeletionAllowed(row)).toThrow(
      "HISTORICAL_PROJECT_CONTEXT_GENERIC_DELETE_FORBIDDEN",
    )
    expect(() => assertGenericDocumentDeletionAllowed({
      historicalCandidateId: null,
      status: "indexed",
    })).not.toThrow()
  })

  it("adds tenant-bound Project/Thread references, uniqueness, and historical safety checks", () => {
    const config = getTableConfig(document)
    const dialect = new PgDialect()
    const render = (expression: SQL | undefined) => expression
      ? dialect.sqlToQuery(expression).sql.replaceAll(/\s+/g, " ").toLowerCase()
      : ""

    expect(config.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "projectId",
      "threadId",
      "historicalCandidateId",
      "historicalClaimId",
      "historicalProvenance",
      "privacy",
      "authority",
      "executionMode",
      "archivedAt",
    ]))
    expect(config.indexes.some((entry) => (
      entry.config.name === "document_historical_candidate_user_idx"
      && entry.config.unique
    ))).toBe(true)
    expect(config.foreignKeys.map((entry) => entry.getName())).toEqual(expect.arrayContaining([
      "document_historical_user_project_fk",
      "document_historical_user_thread_fk",
    ]))
    const checks = new Map(config.checks.map((entry) => [entry.name, render(entry.value)]))
    expect(checks.get("document_historical_identity_check")).toContain("private_project_context")
    const safety = checks.get("document_historical_safety_check") ?? ""
    for (const predicate of [
      '"document"."chunkcount" = 0',
      '"document"."privacy" = \'private\'',
      '"document"."authority" = \'historical_non_authoritative\'',
      '"document"."executionmode" = \'non_executing\'',
      "archived_private_project_context",
      '"document"."archivedat" is not null',
    ]) {
      expect(safety).toContain(predicate)
    }
  })

  it("keeps migration 0014 replay-safe while preserving the Doctrine section", () => {
    const migration = readFileSync("migrations/0014-historical-knowledge-promotion.sql", "utf8")
    const normalized = migration.replaceAll(/\s+/g, " ")

    for (const column of [
      "projectId",
      "threadId",
      "historicalCandidateId",
      "historicalClaimId",
      "historicalProvenance",
      "privacy",
      "authority",
      "executionMode",
      "archivedAt",
    ]) {
      expect(normalized).toContain(`column_name = '${column}'`)
      expect(normalized).toContain(`ADD COLUMN "${column}"`)
    }
    expect(normalized).toContain('CREATE UNIQUE INDEX "document_historical_candidate_user_idx" ON "document" ("userId", "historicalCandidateId") WHERE "historicalCandidateId" IS NOT NULL')
    for (const constraint of [
      "document_historical_user_project_fk",
      "document_historical_user_thread_fk",
      "document_historical_identity_check",
      "document_historical_safety_check",
    ]) {
      expect(normalized).toContain(`conname = '${constraint}'`)
      expect(normalized).toContain(`ADD CONSTRAINT "${constraint}"`)
    }
    expect(normalized).toContain('FOREIGN KEY ("userId", "projectId") REFERENCES "project"("userId", "id") ON DELETE RESTRICT')
    expect(normalized).toContain('FOREIGN KEY ("userId", "threadId") REFERENCES "workbench_thread"("userId", "id") ON DELETE RESTRICT')
    expect(normalized).toContain('CREATE OR REPLACE FUNCTION "reject_historical_document_chunk"()')
    expect(normalized).toContain("d.\"status\" IN ('private_project_context', 'archived_private_project_context')")
    expect(normalized).toContain('CREATE TRIGGER "document_chunk_reject_historical_insert" BEFORE INSERT OR UPDATE OF "documentId" ON "document_chunk"')
    expect(normalized).toContain('CREATE OR REPLACE FUNCTION "reject_historical_document_with_chunks"()')
    expect(normalized).toContain('CREATE TRIGGER "document_reject_historical_with_chunks" BEFORE INSERT OR UPDATE OF "status", "historicalCandidateId", "chunkCount" ON "document"')
  })
})
