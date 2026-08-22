import { randomUUID } from "node:crypto"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { afterEach, describe, expect, it, vi } from "vitest"

const databaseUrl = process.env.HERMES_PROJECT_EXECUTION_TEST_DATABASE_URL
const runDatabase = databaseUrl ? describe : describe.skip
const intent = "record structured #911 reliability remediation without host mutation"
const contractId = "issue-911-live-nonempty-acceptance.v1"
const key = `workbench-outcome:${contractId}:11111111-1111-4111-8111-111111111111`
const ddl = `
  CREATE TABLE goal (
    id serial PRIMARY KEY,"userId" text NOT NULL,ref text,command text NOT NULL,
    lane text NOT NULL,mode text NOT NULL,risk text NOT NULL,authority text NOT NULL DEFAULT 'A0_READ_ONLY',
    verdict text NOT NULL,rationale text,"mistakePatterns" text[] NOT NULL DEFAULT '{}',
    "matchedRules" text[] NOT NULL DEFAULT '{}',"acceptedContractIds" text[] NOT NULL DEFAULT '{}',
    "recommendedMove" text,"requiresApproval" boolean NOT NULL DEFAULT false,
    "linkedWorkOrderId" integer,status text NOT NULL DEFAULT 'classified',
    "createdAt" timestamp NOT NULL DEFAULT now(),"updatedAt" timestamp NOT NULL DEFAULT now()
  );
  CREATE TABLE outcome_queue_item (
    id serial PRIMARY KEY,"userId" text NOT NULL,"outcomeKey" text NOT NULL,"goalId" integer,"goalRef" text,
    title text NOT NULL,objective text,"queueOrder" integer NOT NULL DEFAULT 0,"dependencyKeys" text[] NOT NULL DEFAULT '{}',
    "acceptedContractIds" text[] NOT NULL DEFAULT '{}',"riskClass" text NOT NULL DEFAULT 'R1',
    "approvalState" text NOT NULL DEFAULT 'unapproved',"approvedBy" text,"approvedAt" timestamptz,
    "approvalDecisionId" integer,"authorityState" text NOT NULL DEFAULT 'unverified',
    "authorityLevel" text NOT NULL DEFAULT 'A0_READ_ONLY',"authorityGrantRef" text,
    "authoritySubject" text NOT NULL DEFAULT 'operator',"authorityAction" text NOT NULL DEFAULT 'outcome:execute',
    "lifecycleState" text NOT NULL DEFAULT 'suggested',"lifecycleReason" text,"activeWorkOrderId" integer,
    "executionBinding" text,"leaseHolder" text,"leaseToken" text,"leaseExpiresAt" timestamptz,
    "fencingToken" integer NOT NULL DEFAULT 0,version integer NOT NULL DEFAULT 0,"acquisitionKey" text,
    "terminalResult" text,"terminalEvidenceId" integer,"terminalEvidenceRefs" text[] NOT NULL DEFAULT '{}',
    "terminalKey" text,"supersedesOutcomeKey" text,"supersededByOutcomeKey" text,
    "suggestedAt" timestamptz NOT NULL DEFAULT now(),"activatedAt" timestamptz,"terminalAt" timestamptz,
    "createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE goal_outcome_intake_receipt (
    id serial PRIMARY KEY,"userId" text NOT NULL,"idempotencyKey" text NOT NULL,"requestHash" text NOT NULL,
    "goalId" integer NOT NULL,"outcomeKey" text NOT NULL,"acceptedContractIds" text[] NOT NULL DEFAULT '{}',
    "resultDigest" text NOT NULL,"replayCount" integer NOT NULL DEFAULT 0,
    "firstSubmittedAt" timestamptz NOT NULL DEFAULT now(),"lastReplayedAt" timestamptz,
    UNIQUE("userId","idempotencyKey"),UNIQUE("userId","goalId"),UNIQUE("userId","outcomeKey")
  );
  CREATE TABLE project (id serial PRIMARY KEY,"userId" text NOT NULL,key text NOT NULL,name text NOT NULL,
    lifecycle text NOT NULL DEFAULT 'standby',"createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now());
  CREATE TABLE project_resource (id serial PRIMARY KEY,"userId" text NOT NULL,"projectId" integer NOT NULL,
    type text NOT NULL,"canonicalIdentity" text NOT NULL,label text NOT NULL,relationship text NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now());
  CREATE TABLE workbench_thread (id text PRIMARY KEY,"userId" text NOT NULL,"projectId" integer NOT NULL,
    title text NOT NULL,"createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now());
  CREATE TABLE workbench_thread_source (id serial PRIMARY KEY,"userId" text NOT NULL,"threadId" text NOT NULL,
    "sourceType" text NOT NULL,"sourceId" text NOT NULL,role text NOT NULL,"createdAt" timestamptz NOT NULL DEFAULT now());
  CREATE TABLE governance_event (id serial PRIMARY KEY,"userId" text NOT NULL,ref text,"eventType" text NOT NULL,
    "entityType" text,"entityId" text,actor text,reason text,"beforeHash" text,"afterHash" text,
    "evidenceId" integer,metadata jsonb,"createdAt" timestamp NOT NULL DEFAULT now());
  CREATE TABLE event_log (id serial PRIMARY KEY,"userId" text NOT NULL,type text NOT NULL,summary text NOT NULL,
    register text,"refId" integer,metadata jsonb,"createdAt" timestamp NOT NULL DEFAULT now());
  CREATE UNIQUE INDEX goal_issue_911_live_acceptance_singleton_idx ON goal ("userId")
    WHERE "acceptedContractIds"=ARRAY['${contractId}']::text[];
  CREATE UNIQUE INDEX outcome_queue_item_issue_911_live_acceptance_singleton_idx ON outcome_queue_item ("userId")
    WHERE "acceptedContractIds"=ARRAY['${contractId}']::text[];
  CREATE UNIQUE INDEX goal_intake_issue_911_live_acceptance_singleton_idx ON goal_outcome_intake_receipt ("userId")
    WHERE "acceptedContractIds"=ARRAY['${contractId}']::text[];
`

function directDatabaseUrl(url: string) {
  const parsed = new URL(url)
  parsed.hostname = parsed.hostname.replace("-pooler.", ".")
  return parsed.toString()
}

function schemaDatabaseUrl(url: string, schema: string) {
  const parsed = new URL(directDatabaseUrl(url))
  parsed.searchParams.set("options", `-csearch_path=${schema}`)
  return parsed.toString()
}

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

runDatabase("registered #911 intake PostgreSQL contract", { timeout: 60_000 }, () => {
  it("atomically persists the exact singleton through typed text-array predicates", async () => {
    const schema = `goal_intake_array_${randomUUID().replaceAll("-", "")}`
    const admin = new Pool({ connectionString: directDatabaseUrl(databaseUrl!) })
    let pool: Pool | null = null
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`)
      pool = new Pool({ connectionString: schemaDatabaseUrl(databaseUrl!, schema), max: 4 })
      await pool.query(ddl)
      await pool.query(`INSERT INTO project (id,"userId",key,name,lifecycle)
        VALUES (1,'owner','williamos','WilliamOS','active')`)
      await pool.query(`INSERT INTO project_resource
        ("userId","projectId",type,"canonicalIdentity",label,relationship)
        VALUES ('owner',1,'repo','bsvalues/terragroq','TerraGroq','primary-repo')`)

      const database = drizzle(pool)
      vi.doMock("@/lib/db", () => ({ db: database }))
      vi.doMock("@/lib/session", () => ({ getUserId: async () => "owner" }))
      vi.doMock("@/app/actions/locks", () => ({ getActiveLocks: async () => [] }))
      vi.doMock("@/app/actions/doctrine", () => ({
        validateAction: async () => ({ verdict: "allowed", matches: [] }),
      }))
      vi.doMock("@/lib/goal/classifier", () => ({
        classifyGoal: () => ({
          lane: "operator-objective", mode: "implement", risk: "R1",
          authority: "A2_WRITE_OWN", verdict: "requires_approval",
          rationale: "Registered #911 acceptance", mistakePatterns: [],
          doctrineViolations: [], recommendedMove: "Record bounded evidence",
        }),
      }))
      vi.doMock("@/app/actions/work-orders", () => ({ createWorkOrder: vi.fn() }))
      vi.doMock("@/lib/goal/loop", () => ({
        runLoopVerifier: vi.fn(), refuseExecution: vi.fn(),
      }))
      vi.doMock("@/lib/registers/events", () => ({
        getRecentEvents: async () => [], logEvent: vi.fn(),
      }))
      vi.doMock("@/lib/intent/router", () => ({
        routeUniversalIntent: () => ({ state: "routed", destination: { action: "start_outcome" } }),
      }))
      vi.doMock("@/scripts/hermes-bridge/outcome-queue-source.mjs", () => ({
        ensureOutcomeQueueHardeningSchema: async () => true,
      }))
      vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }))

      const { startGoalOutcome } = await import("@/app/actions/goals")
      await expect(startGoalOutcome({ projectId: 1, intent, idempotencyKey: key }))
        .resolves.toMatchObject({ status: "ACCEPTED", projectId: 1 })
      await expect(startGoalOutcome({ projectId: 1, intent, idempotencyKey: key }))
        .resolves.toMatchObject({ status: "ALREADY_ACCEPTED", projectId: 1 })
      await expect(startGoalOutcome({
        projectId: 1,
        intent,
        idempotencyKey: `workbench-outcome:${contractId}:22222222-2222-4222-8222-222222222222`,
      })).resolves.toMatchObject({
        status: "CONFLICT", reason: "CONTRACT_SINGLETON_CONFLICT", projectId: 1,
      })

      const graph = await pool.query(`SELECT
        (SELECT count(*)::integer FROM goal
          WHERE "acceptedContractIds"=ARRAY[$1]::text[]) AS goals,
        (SELECT count(*)::integer FROM outcome_queue_item
          WHERE "acceptedContractIds"=ARRAY[$1]::text[]) AS outcomes,
        (SELECT count(*)::integer FROM goal_outcome_intake_receipt
          WHERE "acceptedContractIds"=ARRAY[$1]::text[]) AS receipts,
        (SELECT count(*)::integer FROM workbench_thread_source
          WHERE "sourceType"='outcome' AND role='root') AS roots`, [contractId])
      expect(graph.rows).toEqual([{ goals: 1, outcomes: 1, receipts: 1, roots: 1 }])
      await expect(pool.query(`SELECT "replayCount" FROM goal_outcome_intake_receipt`))
        .resolves.toMatchObject({ rows: [{ replayCount: 1 }] })

      await pool.query(`TRUNCATE event_log,governance_event,goal_outcome_intake_receipt,
        workbench_thread_source,workbench_thread,outcome_queue_item,goal RESTART IDENTITY`)
      const concurrent = await Promise.all([
        startGoalOutcome({
          projectId: 1,
          intent,
          idempotencyKey: `workbench-outcome:${contractId}:33333333-3333-4333-8333-333333333333`,
        }),
        startGoalOutcome({
          projectId: 1,
          intent,
          idempotencyKey: `workbench-outcome:${contractId}:44444444-4444-4444-8444-444444444444`,
        }),
      ])
      expect(concurrent.map((result) => result.status).sort()).toEqual(["ACCEPTED", "CONFLICT"])
      const concurrentGraph = await pool.query(`SELECT
        (SELECT count(*)::integer FROM goal) AS goals,
        (SELECT count(*)::integer FROM outcome_queue_item) AS outcomes,
        (SELECT count(*)::integer FROM goal_outcome_intake_receipt) AS receipts,
        (SELECT count(*)::integer FROM workbench_thread_source) AS roots`)
      expect(concurrentGraph.rows).toEqual([{ goals: 1, outcomes: 1, receipts: 1, roots: 1 }])
    } finally {
      await pool?.end()
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    }
  })
})
