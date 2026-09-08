import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { describe, expect, it, vi } from "vitest"

import { createWorkingWorld } from "@/lib/environment/working-world"

const databaseUrl = process.env.EXTERNAL_PARENT_MISSION_TEST_DATABASE_URL
  ?? process.env.HERMES_PROJECT_EXECUTION_TEST_DATABASE_URL
const runDatabase = databaseUrl ? describe : describe.skip

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

function mission(objective = "Launch the complete Washington assessor product mission.") {
  return {
    source: "github" as const,
    repository: "bsvalues/terrafusion_os_1.0",
    externalRef: "github:bsvalues/terrafusion_os_1.0#1485",
    issueNumber: 1485,
    goalRef: "GOAL-WASHINGTON-ASSESSOR-LAUNCH-V1",
    loopRef: "LOOP-WASHINGTON-ASSESSOR-LAUNCH-V1",
    objective,
    terminalConditions: ["All 39 counties proven", "External assessor acceptance"],
    authorityEvidence: ["github:bsvalues/terrafusion_os_1.0#1485", "owner-directive:issue-1485"],
  }
}

runDatabase("external parent mission admission real PostgreSQL contract", { timeout: 90_000 }, () => {
  it("binds exactly once without creating executable state or altering an active child Space", async () => {
    const admin = new Pool({ connectionString: directDatabaseUrl(databaseUrl!) })
    const schema = `external_parent_${randomUUID().replaceAll("-", "")}`
    const priorDatabaseUrl = process.env.DATABASE_URL
    let fixture: Pool | null = null
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`)
      const scopedUrl = schemaDatabaseUrl(databaseUrl!, schema)
      fixture = new Pool({ connectionString: scopedUrl, max: 8 })
      await installSchema(fixture, schema)
      await fixture.query(`INSERT INTO project (id,"userId",key,name,lifecycle)
        VALUES (1,'owner','terrafusion','TerraFusion','active'),(2,'other','terrafusion','Other','active')`)
      await fixture.query(`INSERT INTO project_resource
        (id,"userId","projectId",type,"canonicalIdentity",label,relationship,"allowedOperations") VALUES
        (7,'owner',1,'repo','bsvalues/terrafusion_os_1.0','OS 1.0','primary-repo',ARRAY['read','write']),
        (8,'other',2,'repo','bsvalues/terrafusion_os_1.0','OS 1.0','primary-repo',ARRAY['read','write'])`)
      const activeWorld = {
        ...createWorkingWorld({
          intent: "Continue the TerraFusion mission.",
          resources: ["repo:bsvalues/terrafusion_os_1.0"],
        }),
        spine: {
          projectId: 1,
          projectName: "TerraFusion",
          threadId: "existing-thread",
          outcomeKey: "existing-child",
          outcomeTitle: "Existing child",
          workOrderId: 110,
          execution: "implementing" as const,
          worker: null,
          evidence: [],
        },
      }
      const wrongWorld = createWorkingWorld({ intent: "Wrong repo", resources: ["repo:owner/other"] })
      await fixture.query(`INSERT INTO working_world (id,"userId",intent,snapshot) VALUES
        ('space-tf','owner',$1,$2),('space-wrong','owner',$3,$4)`, [
          activeWorld.intent, JSON.stringify(activeWorld), wrongWorld.intent, JSON.stringify(wrongWorld),
        ])
      const beforeSnapshot = (await fixture.query(`SELECT snapshot FROM working_world WHERE id='space-tf'`)).rows[0].snapshot

      process.env.DATABASE_URL = scopedUrl
      const database = drizzle(fixture)
      vi.resetModules()
      vi.doMock("@/lib/db", () => ({ db: database, pool: fixture }))
      const {
        admitExternalParentMission,
        previewExternalParentMissionAdmission,
        readExternalParentMissionState,
        terminalExternalParentMission,
      } = await import("@/lib/environment/external-parent-mission-admission")
      const admission = (worldId: string, idempotencyKey: string, parent = mission()) => {
        const preview = previewExternalParentMissionAdmission({
          mode: "PREVIEW", worldId, externalParentMission: parent,
        })
        return {
          mode: "ADMIT", worldId, idempotencyKey,
          confirmation: "ADMIT_EXTERNAL_PARENT_MISSION",
          confirmedProvenanceDigest: preview.provenanceDigest,
          externalParentMission: parent,
        }
      }

      const body = admission("space-tf", "external-parent:1485")
      const concurrent = await Promise.all([
        admitExternalParentMission("owner", body),
        admitExternalParentMission("owner", body),
      ])
      expect(concurrent.map((entry) => entry.status).sort()).toEqual(["ADMITTED", "ALREADY_ADMITTED"])
      const admitted = concurrent.find((entry) => entry.status === "ADMITTED")!
      expect(admitted).toMatchObject({
        replayed: false,
        worldId: "space-tf",
        repositoryResourceId: 7,
        loopRef: "LOOP-WASHINGTON-ASSESSOR-LAUNCH-V1",
        binding: {
          source: "github",
          repository: "bsvalues/terrafusion_os_1.0",
          externalRef: "github:bsvalues/terrafusion_os_1.0#1485",
          issueNumber: 1485,
          goalRef: "GOAL-WASHINGTON-ASSESSOR-LAUNCH-V1",
          projectId: 1,
        },
      })
      await expect(admitExternalParentMission("owner", body)).resolves.toMatchObject({
        status: "ALREADY_ADMITTED", replayed: true, receiptId: admitted.receiptId,
      })

      await fixture.query(`UPDATE working_world SET snapshot=$1 WHERE id='space-tf'`, [JSON.stringify(wrongWorld)])
      await fixture.query(`UPDATE project SET lifecycle='archived' WHERE id=1`)
      await fixture.query(`UPDATE project_resource SET "canonicalIdentity"='owner/moved' WHERE id=7`)
      await expect(admitExternalParentMission("owner", body)).resolves.toMatchObject({
        status: "ALREADY_ADMITTED", replayed: true, receiptId: admitted.receiptId,
        worldId: "space-tf", repositoryResourceId: 7,
      })
      await fixture.query(`UPDATE working_world SET snapshot=$1 WHERE id='space-tf'`, [beforeSnapshot])
      await fixture.query(`UPDATE project SET lifecycle='active' WHERE id=1`)
      await fixture.query(`UPDATE project_resource SET "canonicalIdentity"='bsvalues/terrafusion_os_1.0' WHERE id=7`)

      const counts = (await fixture.query(`SELECT
        (SELECT count(*)::int FROM outcome_queue_mutation_receipt) receipts,
        (SELECT count(*)::int FROM goal) goals,
        (SELECT count(*)::int FROM work_order) work_orders,
        (SELECT count(*)::int FROM decision) decisions,
        (SELECT count(*)::int FROM authority_grant) grants,
        (SELECT count(*)::int FROM outcome_queue_item) outcomes`)).rows[0]
      expect(counts).toEqual({ receipts: 1, goals: 0, work_orders: 0, decisions: 0, grants: 0, outcomes: 0 })
      expect((await fixture.query(`SELECT snapshot FROM working_world WHERE id='space-tf'`)).rows[0].snapshot)
        .toBe(beforeSnapshot)
      await expect(readExternalParentMissionState("owner")).resolves.toMatchObject({
        integrity: "VERIFIED",
        unresolved: [{
          externalRef: "github:bsvalues/terrafusion_os_1.0#1485",
          goalRef: "GOAL-WASHINGTON-ASSESSOR-LAUNCH-V1",
        }],
        resolved: [],
      })
      await expect(readExternalParentMissionState("other")).resolves.toEqual({
        integrity: "VERIFIED", unresolved: [], resolved: [],
      })

      await expect(admitExternalParentMission("owner", admission(
        "space-tf", "external-parent:1485", mission("Drifted objective"),
      ))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" })
      await expect(admitExternalParentMission("owner", admission(
        "space-tf", "external-parent:1485:duplicate",
      ))).rejects.toMatchObject({ code: "PARENT_MISSION_ALREADY_BOUND" })
      await expect(admitExternalParentMission("owner", admission(
        "space-wrong", "external-parent:wrong",
      ))).rejects.toMatchObject({ code: "PROJECT_REPOSITORY_MISMATCH" })

      const terminalBody = {
        mode: "TERMINAL",
        missionKey: admitted.binding.missionKey,
        bindReceiptId: admitted.receiptId,
        bindReceiptHash: admitted.bindReceiptHash,
        terminalState: "REVOKED",
        terminalEvidenceRefs: ["owner-revocation:issue-1485"],
        idempotencyKey: "external-parent:1485:terminal",
      }
      const terminalConcurrent = await Promise.all([
        terminalExternalParentMission("owner", terminalBody),
        terminalExternalParentMission("owner", terminalBody),
      ])
      expect(terminalConcurrent.map((entry) => entry.status).sort()).toEqual([
        "ALREADY_TERMINAL", "TERMINAL_RECORDED",
      ])
      const terminal = terminalConcurrent.find((entry) => entry.status === "TERMINAL_RECORDED")!
      await expect(terminalExternalParentMission("owner", terminalBody)).resolves.toMatchObject({
        status: "ALREADY_TERMINAL", replayed: true, receiptId: terminal.receiptId,
        terminalState: "REVOKED",
      })
      await expect(readExternalParentMissionState("owner")).resolves.toMatchObject({
        integrity: "VERIFIED",
        unresolved: [],
        resolved: [{
          missionKey: admitted.binding.missionKey,
          externalRef: "github:bsvalues/terrafusion_os_1.0#1485",
          terminalState: "REVOKED",
        }],
      })
      await expect(terminalExternalParentMission("owner", {
        ...terminalBody,
        idempotencyKey: "external-parent:1485:terminal:second",
      })).rejects.toMatchObject({ code: "PARENT_MISSION_AUTHORITY_REVOKED" })
      await expect(terminalExternalParentMission("owner", {
        ...terminalBody,
        terminalState: "SATISFIED",
      })).rejects.toMatchObject({ code: "PARENT_MISSION_TERMINAL_EVIDENCE_UNVERIFIED" })
      await expect(admitExternalParentMission("owner", body)).rejects.toMatchObject({
        code: "PARENT_MISSION_AUTHORITY_REVOKED",
      })

      const terminalCounts = (await fixture.query(`SELECT
        (SELECT count(*)::int FROM outcome_queue_mutation_receipt) receipts,
        (SELECT count(*)::int FROM goal) goals,
        (SELECT count(*)::int FROM work_order) work_orders,
        (SELECT count(*)::int FROM decision) decisions,
        (SELECT count(*)::int FROM authority_grant) grants,
        (SELECT count(*)::int FROM outcome_queue_item) outcomes`)).rows[0]
      expect(terminalCounts).toEqual({
        receipts: 2, goals: 0, work_orders: 0, decisions: 0, grants: 0, outcomes: 0,
      })
      expect((await fixture.query(`SELECT snapshot FROM working_world WHERE id='space-tf'`)).rows[0].snapshot)
        .toBe(beforeSnapshot)
    } finally {
      vi.resetModules()
      if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = priorDatabaseUrl
      await fixture?.end()
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    }
  })
})
