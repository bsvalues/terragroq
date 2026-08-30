import { execFile } from "node:child_process"
import { generateKeyPairSync, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { afterEach, describe, expect, it, vi } from "vitest"

import { issueLoomCodexDeliverySeal, verifyWilliamOSDeliverySeal } from "@/lib/governance/delivery-seal"
import { createWorkingWorld } from "@/lib/environment/working-world"

const databaseUrl = process.env.EXTERNAL_WORK_ORDER_TEST_DATABASE_URL
  ?? process.env.HERMES_PROJECT_EXECUTION_TEST_DATABASE_URL
const runDatabase = databaseUrl ? describe : describe.skip
const runFile = promisify(execFile)
const roots: string[] = []

function directDatabaseUrl(url: string) {
  const parsed = new URL(url)
  parsed.hostname = parsed.hostname.replace("-pooler.", ".")
  return parsed.toString()
}

function schemaDatabaseUrl(url: string, schema: string) {
  const parsed = new URL(directDatabaseUrl(url))
  parsed.searchParams.set("options", `-csearch_path=${schema},public`)
  return parsed.toString()
}

async function installSchema(pool: Pool, schema: string) {
  const bootstrap = (await fs.readFile(path.join(process.cwd(), "drizzle", "0000_williamos_init.sql"), "utf8"))
    .replaceAll('"public".', `"${schema}".`)
  for (const statement of bootstrap.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
    await pool.query(statement)
  }
  for (const migration of ["0008-resource-record.sql", "0009-resource-key.sql", "0012-working-world.sql"]) {
    await pool.query(await fs.readFile(path.join(process.cwd(), "migrations", migration), "utf8"))
  }
}

async function repositoryFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "external-wo-pg-"))
  roots.push(root)
  await runFile("git", ["init", "--quiet", root])
  await runFile("git", ["-C", root, "config", "user.email", "test@example.test"])
  await runFile("git", ["-C", root, "config", "user.name", "Test"])
  await fs.mkdir(path.join(root, "src"), { recursive: true })
  await fs.writeFile(path.join(root, "src", "selected.ts"), "export const selected = true\n", "utf8")
  await runFile("git", ["-C", root, "add", "--", "src/selected.ts"])
  await runFile("git", ["-C", root, "commit", "--quiet", "-m", "fixture"])
  return root
}

function world(intent: string) {
  return {
    ...createWorkingWorld({ intent, resources: ["repo:owner/repo"] }),
    space: {
      schemaVersion: 1 as const, revision: 1,
      windows: [{
        id: "editor", kind: "editor" as const, title: "Selected",
        frame: { x: 0, y: 0, width: 800, height: 600 }, z: 1, minimized: false,
      }],
      openFiles: ["src/selected.ts"],
      panes: [{ id: "pane", filePath: "src/selected.ts", selection: null }],
      selection: null, activeWindowId: "editor", activePaneId: "pane", runningAppUrl: null,
    },
  }
}

function packet(objective = "Write source through the exact governed reservation.") {
  return {
    source: "github", externalRef: "github:owner/repo#1111", title: "External governed change",
    objective, repository: "owner/repo", authorityEvidence: ["owner-confirmation:1111"],
    reservedPaths: ["src/selected.ts"], forbiddenPaths: ["src/forbidden.ts"],
    validators: ["pnpm test"], acceptanceCriteria: ["The exact assignment remains governed"],
    pullRequest: { number: 1111, headSha: "a".repeat(40) },
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
  vi.resetModules()
})

// Exercises the real PostgreSQL transactional admission seam.
runDatabase("external Work Order admission real PostgreSQL contract", { timeout: 90_000 }, () => {
  it("atomically admits, replays, fences conflicts and drift, and remains Codex/seal compatible", async () => {
    const admin = new Pool({ connectionString: directDatabaseUrl(databaseUrl!) })
    const schema = `external_wo_${randomUUID().replaceAll("-", "")}`
    const priorDatabaseUrl = process.env.DATABASE_URL
    let fixture: Pool | null = null
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`)
      const scopedUrl = schemaDatabaseUrl(databaseUrl!, schema)
      fixture = new Pool({ connectionString: scopedUrl, max: 8 })
      await installSchema(fixture, schema)
      await fixture.query(`INSERT INTO project (id,"userId",key,name,lifecycle)
        VALUES (1,'owner','repo','Owner Repo','active')`)
      await fixture.query(`INSERT INTO project_resource
        ("userId","projectId",type,"canonicalIdentity",label,relationship,"allowedOperations")
        VALUES ('owner',1,'repo','owner/repo','owner/repo','primary-repo',ARRAY['read','write'])`)
      for (const id of ["world-good", "world-forbidden"]) {
        const snapshot = world(id)
        await fixture.query(`INSERT INTO working_world (id,"userId",intent,snapshot)
          VALUES ($1,'owner',$1,$2)`, [id, JSON.stringify(snapshot)])
      }
      await fixture.query(`INSERT INTO doctrine
        ("userId",ref,title,statement,category,status,priority,active,allowed,forbidden,"requiresApproval")
        VALUES ('owner','RULE-PG','Postgres gate','Exercise canonical activation','guardrail','active',100,true,
          ARRAY[]::text[],ARRAY['destroy production'],ARRAY['write source'])`)
      process.env.DATABASE_URL = scopedUrl
      const database = drizzle(fixture)
      vi.doMock("@/lib/db", () => ({ db: database, pool: fixture }))
      const artifactReceiptCounts: number[] = []
      const artifactRoot = await fs.mkdtemp(path.join(os.tmpdir(), "external-wo-artifacts-"))
      roots.push(artifactRoot)
      const artifactSuccesses: string[] = []
      const artifactAttempts = new Map<string, number>()
      const artifactWrites = vi.fn(async (input: { id: string; category: string }) => {
        const persisted = await fixture!.query(`SELECT count(*)::int AS count
          FROM outcome_queue_mutation_receipt WHERE "userId"='owner'`)
        artifactReceiptCounts.push(persisted.rows[0]?.count ?? 0)
        const attempt = (artifactAttempts.get(input.id) ?? 0) + 1
        artifactAttempts.set(input.id, attempt)
        const markdownPath = path.join(artifactRoot, `${input.id}.md`)
        const jsonPath = path.join(artifactRoot, `${input.id}.json`)
        if (input.id === "GRANT-0002" && attempt === 1) {
          return { id: input.id, category: input.category, markdownPath, jsonPath, sha256: "failed", wrote: false }
        }
        await Promise.all([fs.writeFile(markdownPath, input.id), fs.writeFile(jsonPath, input.id)])
        artifactSuccesses.push(input.id)
        return { id: input.id, category: input.category, markdownPath, jsonPath, sha256: input.id, wrote: true }
      })
      vi.doMock("@/lib/governance/artifacts", () => ({ writeArtifact: artifactWrites }))
      const [{ admitExternalWorkOrder, previewExternalWorkOrderAdmission }, { deriveCodexAssignment, revalidateCodexAssignment }] = await Promise.all([
        import("@/lib/environment/external-work-order-admission"),
        import("@/lib/loom/codex-assignment"),
      ])
      const admission = (worldId: string, idempotencyKey: string, externalWorkOrder = packet()) => {
        const preview = previewExternalWorkOrderAdmission({ mode: "PREVIEW", worldId, externalWorkOrder })
        return {
          mode: "ADMIT", worldId, idempotencyKey,
          confirmation: "ADMIT_EXTERNAL_WORK_ORDER",
          confirmedProvenanceDigest: preview.provenanceDigest,
          externalWorkOrder,
        }
      }

      await expect(admitExternalWorkOrder("owner", admission(
        "world-forbidden", "external:forbidden:1111", packet("Destroy production now."),
      ))).rejects.toMatchObject({ code: "DOCTRINE_FORBIDDEN" })
      const rolledBack = await fixture.query(`SELECT
        (SELECT count(*)::int FROM work_order) AS works,
        (SELECT count(*)::int FROM authority_grant) AS grants,
        (SELECT count(*)::int FROM outcome_queue_item) AS outcomes,
        (SELECT count(*)::int FROM outcome_queue_mutation_receipt) AS receipts`)
      expect(rolledBack.rows).toEqual([{ works: 0, grants: 0, outcomes: 0, receipts: 0 }])

      const body = admission("world-good", "external:good:1111")
      const concurrent = await Promise.all([
        admitExternalWorkOrder("owner", body), admitExternalWorkOrder("owner", body),
      ])
      expect(concurrent.map((result) => result.status).sort()).toEqual(["ADMITTED", "ALREADY_ADMITTED"])
      const admitted = concurrent.find((result) => result.status === "ADMITTED")!
      expect(artifactWrites).toHaveBeenCalledTimes(3)
      expect(artifactSuccesses.sort()).toEqual(["GRANT-0001", "GRANT-0002"])
      await expect(admitExternalWorkOrder("owner", body)).resolves.toMatchObject({
        status: "ALREADY_ADMITTED", replayed: true, outcomeKey: admitted.outcomeKey,
      })
      expect(artifactWrites).toHaveBeenCalledTimes(3)
      expect(artifactSuccesses).toHaveLength(2)
      await expect(admitExternalWorkOrder("owner", body)).resolves.toMatchObject({ status: "ALREADY_ADMITTED" })
      expect(artifactWrites).toHaveBeenCalledTimes(3)
      expect(artifactSuccesses).toHaveLength(2)
      const persistedGrantRefs = await fixture.query(`SELECT ref FROM authority_grant ORDER BY ref`)
      expect(new Set(artifactWrites.mock.calls.map(([input]) => input.id))).toEqual(
        new Set(persistedGrantRefs.rows.map((row) => row.ref)),
      )
      expect(artifactReceiptCounts.every((count) => count === 1)).toBe(true)

      const changed = admission("world-good", "external:good:1111", { ...packet(), title: "Changed intent" })
      await expect(admitExternalWorkOrder("owner", changed)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" })
      const graph = await fixture.query(`SELECT
        world.snapshot, project.lifecycle, resource."canonicalIdentity", thread."projectId",
        root.role, outcome."lifecycleState", outcome."activeWorkOrderId", outcome."acquisitionKey",
        work.status AS "workStatus", work."authorityGranted", work."authorityGrantId",
        implementation."grantedTo" AS "implementationTo", implementation."allowedActions",
        queue."grantedTo" AS "queueTo", queue."allowedActions" AS "queueActions",
        acquisition."firstFencingToken", acquisition."latestFencingToken"
        FROM working_world world
        JOIN project ON project.id=(world.snapshot::jsonb#>>'{spine,projectId}')::int AND project."userId"=world."userId"
        JOIN project_resource resource ON resource."projectId"=project.id AND resource.relationship='primary-repo'
        JOIN workbench_thread thread ON thread.id=world.snapshot::jsonb#>>'{spine,threadId}'
        JOIN workbench_thread_source root ON root."threadId"=thread.id AND root.role='root'
        JOIN outcome_queue_item outcome ON outcome."outcomeKey"=world.snapshot::jsonb#>>'{spine,outcomeKey}'
        JOIN work_order work ON work.id=outcome."activeWorkOrderId"
        JOIN authority_grant implementation ON implementation.id=work."authorityGrantId"
        JOIN authority_grant queue ON queue.ref=outcome."authorityGrantRef"
        JOIN outcome_queue_acquisition_receipt acquisition ON acquisition."acquisitionKey"=outcome."acquisitionKey"
        WHERE world.id='world-good'`)
      expect(graph.rows).toHaveLength(1)
      expect(graph.rows[0]).toMatchObject({
        lifecycle: "active", canonicalIdentity: "owner/repo", role: "root", lifecycleState: "active",
        workStatus: "active", authorityGranted: "A2_WRITE_OWN", implementationTo: "codex",
        allowedActions: ["src/selected.ts"], queueTo: "operator", queueActions: ["outcome:execute"],
        firstFencingToken: 1, latestFencingToken: 1,
      })
      const explicitDoctrine = await fixture.query(`SELECT metadata FROM governance_event
        WHERE "entityType"='work_order' AND "eventType"='WO_TRANSITION'
          AND metadata->>'doctrineVerdict'='requires_approval'`)
      expect(explicitDoctrine.rows[0]?.metadata).toMatchObject({ doctrineApprovedBy: "owner" })

      const projectRoot = await repositoryFixture()
      const assignment = await deriveCodexAssignment({ userId: "owner", worldId: "world-good", projectRoot })
      await expect(revalidateCodexAssignment(assignment)).resolves.toBeUndefined()
      const { privateKey, publicKey } = generateKeyPairSync("ed25519")
      const metadata = {
        assignmentVersion: "loom-codex-assignment.v1", owner: "owner", provider: "Codex", mode: "delegate",
        workspace: projectRoot, threadId: "thread-seal", resumed: false, worldId: assignment.worldId,
        spaceRevision: assignment.binding.spaceRevision,
        outcome: { id: assignment.binding.outcomeId, key: assignment.outcomeKey, version: assignment.binding.outcomeVersion },
        workOrder: { id: assignment.workOrderId, ref: assignment.binding.workOrderRef, version: assignment.binding.workOrderVersion },
        grant: { id: assignment.grantId, ref: assignment.binding.grantRef, version: assignment.binding.grantVersion },
        reservation: { allowed: assignment.allowed, forbidden: assignment.forbidden, version: assignment.binding.reservationVersion },
        promotionPath: assignment.selectedPath, assignmentHash: assignment.assignmentHash,
        task: { digest: "d".repeat(64), text: "Execute the admitted assignment." },
        executionBindingHash: "e".repeat(64), isolatedBaseSha: "1".repeat(40),
      }
      const seal = await issueLoomCodexDeliverySeal({
        userId: "owner", threadId: "thread-seal", assignmentHash: assignment.assignmentHash,
        commitSha: "2".repeat(40),
      }, {
        loadAssignment: async () => ({ eventId: 1, metadata }),
        loadReady: async () => ({ eventId: 2, metadata: {
          provider: "Codex", mode: "delegate", workspace: projectRoot,
          committed: true, worldId: assignment.worldId, outcomeKey: assignment.outcomeKey,
          workOrderId: assignment.workOrderId, grantId: assignment.grantId,
          assignmentHash: assignment.assignmentHash, selectedPath: assignment.selectedPath,
          promotionDigest: "9".repeat(64), taskDigest: "d".repeat(64),
          executionBindingHash: "e".repeat(64), baseSha: "1".repeat(40),
        } }),
        deriveCurrentAssignment: () => deriveCodexAssignment({ userId: "owner", worldId: "world-good", projectRoot }),
        inspectDelivery: async () => ({ repository: "owner/repo", baseSha: "1".repeat(40), commitSha: "2".repeat(40),
          paths: [assignment.selectedPath], patchDigest: "f".repeat(64), contentDigest: "9".repeat(64) }),
        signingKey: { privateKey, publicKey, keyId: "postgres-test" }, recordSeal: async () => undefined,
        now: () => new Date("2026-08-30T20:00:00.000Z"),
      })
      expect(verifyWilliamOSDeliverySeal(seal, { "postgres-test": publicKey })).toBe(true)

      const bindingRow = await fixture.query(`SELECT "resultBinding" FROM outcome_queue_mutation_receipt
        WHERE "userId"='owner' AND "idempotencyKey"='external:good:1111'`)
      const binding = bindingRow.rows[0].resultBinding as Record<string, unknown>
      await fixture.query(`UPDATE work_order SET agent='claude' WHERE id=$1`, [binding.workOrderId])
      await expect(admitExternalWorkOrder("owner", body)).rejects.toMatchObject({ code: "PERSISTED_BINDING_INVALID" })
      await fixture.query(`UPDATE work_order SET agent='codex' WHERE id=$1`, [binding.workOrderId])

      await fixture.query(`UPDATE work_order SET "authorityLevel"='A0_READ_ONLY' WHERE id=$1`, [binding.workOrderId])
      await expect(admitExternalWorkOrder("owner", body)).rejects.toMatchObject({ code: "PERSISTED_BINDING_INVALID" })
      await fixture.query(`UPDATE work_order SET "authorityLevel"='A2_WRITE_OWN' WHERE id=$1`, [binding.workOrderId])

      await fixture.query(`UPDATE authority_grant SET ref='GRANT-DRIFT' WHERE id=$1`, [binding.implementationGrantId])
      await expect(admitExternalWorkOrder("owner", body)).rejects.toMatchObject({ code: "PERSISTED_BINDING_INVALID" })
      await fixture.query(`UPDATE authority_grant SET ref=$1 WHERE id=$2`, [binding.implementationGrantRef, binding.implementationGrantId])

      await fixture.query(`UPDATE work_order SET "linkedDecisionId"=NULL WHERE id=$1`, [binding.workOrderId])
      await expect(admitExternalWorkOrder("owner", body)).rejects.toMatchObject({ code: "PERSISTED_BINDING_INVALID" })
      await fixture.query(`UPDATE work_order SET "linkedDecisionId"=$1 WHERE id=$2`, [binding.approvalDecisionId, binding.workOrderId])

      await fixture.query(`UPDATE working_world SET snapshot=jsonb_set(
        snapshot::jsonb, '{resources}', '["repo:owner/other"]'::jsonb
      )::text WHERE id='world-good'`)
      await expect(admitExternalWorkOrder("owner", body)).rejects.toMatchObject({ code: "PERSISTED_BINDING_INVALID" })
      await fixture.query(`UPDATE working_world SET snapshot=jsonb_set(
        snapshot::jsonb, '{resources}', '["repo:owner/repo"]'::jsonb
      )::text WHERE id='world-good'`)

      const outcomeDrifts = [
        [`"approvalState"`, "revoked"], [`"approvedBy"`, "intruder"],
        [`"authorityState"`, "revoked"], [`"authorityLevel"`, "A0_READ_ONLY"],
        [`"executionBinding"`, "drift"], [`"leaseHolder"`, "drift"], [`"leaseToken"`, "drift"],
      ] as const
      const baselineOutcome = (await fixture.query(`SELECT * FROM outcome_queue_item
        WHERE "outcomeKey"=$1`, [binding.outcomeKey])).rows[0]
      for (const [column, drift] of outcomeDrifts) {
        await fixture.query(`UPDATE outcome_queue_item SET ${column}=$1 WHERE "outcomeKey"=$2`, [drift, binding.outcomeKey])
        await expect(admitExternalWorkOrder("owner", body)).rejects.toMatchObject({ code: "PERSISTED_BINDING_INVALID" })
        await fixture.query(`UPDATE outcome_queue_item SET ${column}=$1 WHERE "outcomeKey"=$2`, [
          baselineOutcome[column.slice(1, -1)], binding.outcomeKey,
        ])
      }
      await fixture.query(`UPDATE outcome_queue_item SET version=2 WHERE "outcomeKey"=$1`, [binding.outcomeKey])
      await expect(admitExternalWorkOrder("owner", body)).rejects.toMatchObject({ code: "PERSISTED_BINDING_INVALID" })
      await fixture.query(`UPDATE outcome_queue_item SET version=$1 WHERE "outcomeKey"=$2`, [
        baselineOutcome.version, binding.outcomeKey,
      ])

      await fixture.query(`UPDATE project SET lifecycle='archived' WHERE id=1`)
      await expect(admitExternalWorkOrder("owner", body)).rejects.toMatchObject({ code: "PERSISTED_BINDING_INVALID" })
    } finally {
      await fixture?.end()
      if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = priorDatabaseUrl
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    }
  })
})
