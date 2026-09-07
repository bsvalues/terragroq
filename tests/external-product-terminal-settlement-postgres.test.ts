import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createWorkingWorld, withBoundOutcome } from "@/lib/environment/working-world"
import { hashRecord } from "@/lib/governance/hash"

const databaseUrl = process.env.EXTERNAL_WORK_ORDER_TEST_DATABASE_URL
  ?? process.env.HERMES_PROJECT_EXECUTION_TEST_DATABASE_URL
const runDatabase = databaseUrl ? describe : describe.skip
const originalDatabaseUrl = process.env.DATABASE_URL

const provenanceDigest = "7ccb6644263e2c120d8bf0e33170eec56d1eb1d54602dc5f81d693a0b94c33da"
const outcomeKey = `external:${provenanceDigest}`
const repository = "bsvalues/terrafusion_os_1.0"
const receiptPath = "os-platform/core/canon/release-closeout/receipts/waco-2026.product-terminal.json"

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

function protectedProof(protectedCommit = "a".repeat(40)) {
  return {
    protectedCommit,
    catalogPath: "os-platform/core/canon/release-closeout/catalog.json" as const,
    catalogSha256: "1".repeat(64),
    receiptPath,
    receiptSha256: "2".repeat(64),
    profilePath: "os-platform/core/canon/release-closeout/waco-2026.policy.json",
    profileSha256: "3".repeat(64),
    receiptId: `tf-product-terminal:${"4".repeat(64)}`,
    contentSha256: "4".repeat(64),
    productId: "terrafusion",
    repository,
    terminalState: "WACO_2026_TERRAFUSION_RELEASE_READY",
    releaseId: "waco-2026",
    releaseSha: "35e32462d9758473e3a193388cd50786dc63cc17",
    deploymentId: "omen-waco-2026",
    acceptedAt: "2026-09-06",
    limitations: ["not statewide", "not production"],
  } as const
}

async function seedGraph(pool: Pool, options: { revoked?: boolean; maxVersion?: boolean } = {}) {
  await pool.query(`INSERT INTO project (id,"userId",key,name,lifecycle)
    VALUES (1,'owner','terrafusion','TerraFusion','active')`)
  const resource = await pool.query(`INSERT INTO project_resource
    ("userId","projectId",type,"canonicalIdentity",label,relationship,"allowedOperations")
    VALUES ('owner',1,'repo',$1,'TerraFusion OS 1.0','primary-repo',ARRAY['read','write']) RETURNING id`, [repository])
  await pool.query(`INSERT INTO goal (id,"userId",ref,command,lane,mode,risk,authority,verdict,status,"acceptedContractIds")
    VALUES (1,'owner','GOAL-WACO','Finish WACO','external-work-order','implement','R1','A2_WRITE_OWN',
      'requires_approval','converted',ARRAY['space-external-work-order-admission.v2'])`)
  await pool.query(`INSERT INTO decision
    (id,"userId",ref,title,decision,status,authority,owner,scope,evidence,locked)
    VALUES (301,'owner','EXT-WO-DEC-WACO','Admit WACO','APPROVE','accepted','binding','owner',$1,
      ARRAY['external-provenance-digest:${provenanceDigest}'],true)`, [outcomeKey])
  await pool.query(`INSERT INTO work_order
    (id,"userId",ref,title,status,"authorityLevel","authorityGranted","authorityGrantId",agent,evidence,"linkedDecisionId")
    VALUES (101,'owner','WO-WACO','WACO 2026','active','A2_WRITE_OWN','A2_WRITE_OWN',201,'codex',ARRAY[]::text[],301)`)
  await pool.query(`INSERT INTO authority_grant
    (id,"userId",ref,"workOrderId","grantedBy","grantedTo","authorityLevel",scope,"allowedActions","blockedActions",status,"revokedAt")
    VALUES
      (201,'owner','GRANT-IMPLEMENTATION',101,'owner','codex','A2_WRITE_OWN','waco',ARRAY['src/**'],ARRAY[]::text[],$1,$2),
      (202,'owner','GRANT-QUEUE',101,'owner','operator','A2_WRITE_OWN',$3,ARRAY['outcome:execute'],ARRAY[]::text[],'expired',NULL)`,
    [options.revoked ? "revoked" : "active", options.revoked ? new Date("2026-09-06T00:00:00Z") : null, outcomeKey])
  const leaseToken = hashRecord({ provenanceDigest, worldId: "world-waco", workOrderId: 101 })
  await pool.query(`INSERT INTO outcome_queue_item
    (id,"userId","outcomeKey","goalId","goalRef",title,"acceptedContractIds","approvalState","approvedBy","approvalDecisionId",
     "authorityState","authorityLevel","authorityGrantRef","authoritySubject","authorityAction","lifecycleState",
     "activeWorkOrderId","executionBinding","leaseHolder","leaseToken","leaseExpiresAt","fencingToken",version,"acquisitionKey")
    VALUES (76,'owner',$1,1,'GOAL-WACO','WACO 2026',ARRAY['space-external-work-order-admission.v2'],
      'approved','owner',301,'matched','A2_WRITE_OWN','GRANT-QUEUE','operator','outcome:execute','active',101,$2,
      'space:world-waco',$3,now() - interval '1 day',1,$4,$5)`, [
    outcomeKey, `space-external:${provenanceDigest}`, leaseToken,
    options.maxVersion ? 2147483647 : 1, `external:${provenanceDigest}`,
  ])
  const baseWorld = createWorkingWorld({ intent: "WACO 2026", resources: [`repo:${repository}`] })
  const world = withBoundOutcome(baseWorld, {
    projectId: 1,
    projectName: "TerraFusion",
    threadId: "thread-waco",
    outcomeKey,
    outcomeTitle: "WACO 2026",
    activeWorkOrderId: 101,
  })
  await pool.query(`INSERT INTO working_world (id,"userId",intent,snapshot)
    VALUES ('world-waco','owner','WACO 2026',$1)`, [JSON.stringify(world)])
  await pool.query(`INSERT INTO outcome_queue_mutation_receipt
    ("userId","idempotencyKey",operation,"outcomeKey","requestHash","requestBinding","resultBinding")
    VALUES ('owner','admit-waco','space.external_work_order.admit',$1,'request', $2, $3)`, [
    outcomeKey,
    {
      provenanceDigest,
      externalWorkOrder: {
        source: "other", externalRef: "WO-TERRAFUSION-WACO-PARALLEL-EXECUTION-001", repository,
      },
    },
    {
      worldId: "world-waco", projectId: 1, projectName: "TerraFusion", threadId: "thread-waco",
      goalId: 1, goalRef: "GOAL-WACO", outcomeId: 76, outcomeKey, workOrderId: 101,
      workOrderRef: "WO-WACO", source: "other",
      externalRef: "WO-TERRAFUSION-WACO-PARALLEL-EXECUTION-001", repository,
      approvalDecisionId: 301, decisionRef: "EXT-WO-DEC-WACO",
      queueGrantId: 202, queueGrantRef: "GRANT-QUEUE",
      implementationGrantId: 201, implementationGrantRef: "GRANT-IMPLEMENTATION",
      acquisitionKey: `external:${provenanceDigest}`, provenanceDigest,
    },
  ])
  return Number(resource.rows[0].id)
}

afterEach(() => {
  process.env.DATABASE_URL = originalDatabaseUrl
  vi.resetModules()
})

runDatabase("external product terminal real PostgreSQL settlement", { timeout: 90_000 }, () => {
  it("settles atomically, accepts expired authority, replays exactly, and rejects proof drift", async () => {
    const admin = new Pool({ connectionString: directDatabaseUrl(databaseUrl!) })
    const schema = `product_terminal_${randomUUID().replaceAll("-", "")}`
    let fixture: Pool | null = null
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`)
      const scopedUrl = schemaDatabaseUrl(databaseUrl!, schema)
      fixture = new Pool({ connectionString: scopedUrl, max: 8 })
      await installSchema(fixture, schema)
      const resourceId = await seedGraph(fixture)
      process.env.DATABASE_URL = scopedUrl
      vi.doMock("@/lib/db", () => ({ db: drizzle(fixture!), pool: fixture }))
      let proof = protectedProof()
      vi.doMock("@/lib/projects/workspace-project-binding", async () => ({
        ...(await vi.importActual<typeof import("@/lib/projects/workspace-project-binding")>(
          "@/lib/projects/workspace-project-binding",
        )),
        resolveTerraFusionWorkspaceBinding: vi.fn(async () => ({
          ok: true,
          binding: { workspaceRoot: "C:/TerraFusion", repositoryIdentity: repository, repositoryResourceId: resourceId, projectId: 1 },
        })),
      }))
      vi.doMock("@/lib/environment/external-product-terminal-receipt", async () => ({
        ...(await vi.importActual<typeof import("@/lib/environment/external-product-terminal-receipt")>(
          "@/lib/environment/external-product-terminal-receipt",
        )),
        loadProtectedProductTerminalProof: vi.fn(async () => proof),
      }))
      const { finalizeExternalProductTerminalOutcome } = await import(
        "@/lib/environment/external-product-terminal-settlement"
      )
      const concurrent = await Promise.all([
        finalizeExternalProductTerminalOutcome({ userId: "owner", worldId: "world-waco" }),
        finalizeExternalProductTerminalOutcome({ userId: "owner", worldId: "world-waco" }),
      ])
      expect(concurrent.map((entry) => entry.replayed).sort()).toEqual([false, true])
      expect(concurrent.every((entry) => entry.status === "PRODUCT_TERMINAL_SETTLED"
        && entry.workOrderId === 101)).toBe(true)
      await expect(finalizeExternalProductTerminalOutcome({ userId: "owner", worldId: "world-waco" }))
        .resolves.toMatchObject({ replayed: true })
      const terminal = await fixture.query(`SELECT outcome."lifecycleState",outcome."terminalResult",work.status,
        (SELECT count(*)::int FROM evidence_record) evidence_count,
        (SELECT count(*)::int FROM governance_event WHERE "eventType"='AUTHORITY_REVOKED') authority_events,
        (SELECT count(*)::int FROM event_log WHERE type='authority.revoked') authority_log_entries,
        (SELECT count(*)::int FROM outcome_queue_mutation_receipt WHERE operation='space.external_product_terminal.finalize') receipt_count
        FROM outcome_queue_item outcome JOIN work_order work ON work.id=outcome."activeWorkOrderId" WHERE outcome.id=76`)
      expect(terminal.rows).toEqual([{
        lifecycleState: "completed", terminalResult: "COMPLETE", status: "closed",
        evidence_count: 1, authority_events: 1, authority_log_entries: 1, receipt_count: 1,
      }])
      proof = protectedProof("b".repeat(40))
      await expect(finalizeExternalProductTerminalOutcome({ userId: "owner", worldId: "world-waco" }))
        .rejects.toThrow("PRODUCT_TERMINAL_CONFLICT")
    } finally {
      await fixture?.end()
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    }
  })

  it("fails on explicit revocation and rolls back every partial write", async () => {
    const admin = new Pool({ connectionString: directDatabaseUrl(databaseUrl!) })
    const schema = `product_terminal_rollback_${randomUUID().replaceAll("-", "")}`
    let fixture: Pool | null = null
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`)
      const scopedUrl = schemaDatabaseUrl(databaseUrl!, schema)
      fixture = new Pool({ connectionString: scopedUrl, max: 4 })
      await installSchema(fixture, schema)
      const resourceId = await seedGraph(fixture, { revoked: true })
      process.env.DATABASE_URL = scopedUrl
      vi.doMock("@/lib/db", () => ({ db: drizzle(fixture!), pool: fixture }))
      vi.doMock("@/lib/projects/workspace-project-binding", () => ({
        resolveTerraFusionWorkspaceBinding: vi.fn(async () => ({ ok: true, binding: {
          workspaceRoot: "C:/TerraFusion", repositoryIdentity: repository, repositoryResourceId: resourceId, projectId: 1,
        } })),
      }))
      vi.doMock("@/lib/environment/external-product-terminal-receipt", async () => ({
        ...(await vi.importActual<typeof import("@/lib/environment/external-product-terminal-receipt")>(
          "@/lib/environment/external-product-terminal-receipt",
        )),
        loadProtectedProductTerminalProof: vi.fn(async () => protectedProof()),
      }))
      const { finalizeExternalProductTerminalOutcome } = await import(
        "@/lib/environment/external-product-terminal-settlement"
      )
      await fixture.query(`UPDATE decision SET status='rejected' WHERE id=301`)
      await expect(finalizeExternalProductTerminalOutcome({ userId: "owner", worldId: "world-waco" }))
        .rejects.toThrow("PRODUCT_TERMINAL_CONTEXT_STALE")
      await fixture.query(`UPDATE decision SET status='accepted' WHERE id=301`)
      await expect(finalizeExternalProductTerminalOutcome({ userId: "owner", worldId: "world-waco" }))
        .rejects.toThrow("PRODUCT_TERMINAL_AUTHORITY_REVOKED")
      const unchanged = await fixture.query(`SELECT
        (SELECT status FROM work_order WHERE id=101) work_status,
        (SELECT "lifecycleState" FROM outcome_queue_item WHERE id=76) outcome_status,
        (SELECT count(*)::int FROM evidence_record) evidence_count,
        (SELECT count(*)::int FROM outcome_queue_mutation_receipt WHERE operation='space.external_product_terminal.finalize') receipt_count`)
      expect(unchanged.rows).toEqual([{
        work_status: "active", outcome_status: "active", evidence_count: 0, receipt_count: 0,
      }])

      // Force a failure after evidence insertion and both governed Work Order transitions.
      // PostgreSQL integer overflow on outcome.version + 1 proves those earlier writes roll back.
      await fixture.query(`UPDATE authority_grant SET status='active', "revokedAt"=NULL WHERE id=201`)
      await fixture.query(`UPDATE outcome_queue_item SET version=2147483647 WHERE id=76`)
      await expect(finalizeExternalProductTerminalOutcome({ userId: "owner", worldId: "world-waco" }))
        .rejects.toThrow()
      const rolledBack = await fixture.query(`SELECT
        (SELECT status FROM work_order WHERE id=101) work_status,
        (SELECT "lifecycleState" FROM outcome_queue_item WHERE id=76) outcome_status,
        (SELECT count(*)::int FROM evidence_record) evidence_count,
        (SELECT count(*)::int FROM governance_event WHERE "eventType" IN
          ('WO_TRANSITION','EXTERNAL_PRODUCT_TERMINAL_FINALIZED')) terminal_events,
        (SELECT count(*)::int FROM outcome_queue_mutation_receipt WHERE operation='space.external_product_terminal.finalize') receipt_count`)
      expect(rolledBack.rows).toEqual([{
        work_status: "active", outcome_status: "active", evidence_count: 0,
        terminal_events: 0, receipt_count: 0,
      }])
    } finally {
      await fixture?.end()
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    }
  })
})
