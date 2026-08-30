import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { Pool, type PoolClient } from "pg"
import { describe, expect, it } from "vitest"

const databaseUrl = process.env.HISTORICAL_PROJECT_CONTEXT_TEST_DATABASE_URL
const runDatabase = databaseUrl ? describe : describe.skip

const prerequisiteDdl = `
  CREATE TABLE doctrine (
    id serial PRIMARY KEY,
    "userId" text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    active boolean NOT NULL DEFAULT false,
    priority integer NOT NULL DEFAULT 0,
    allowed text[] NOT NULL DEFAULT '{}',
    forbidden text[] NOT NULL DEFAULT '{}',
    "requiresApproval" text[] NOT NULL DEFAULT '{}',
    locked boolean NOT NULL DEFAULT false,
    "supersedesId" integer,
    "supersededById" integer
  );
  CREATE TABLE project (
    id serial PRIMARY KEY,
    "userId" text NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    UNIQUE ("userId", key),
    UNIQUE ("userId", id)
  );
  CREATE TABLE workbench_thread (
    id text PRIMARY KEY,
    "userId" text NOT NULL,
    "projectId" integer NOT NULL,
    title text NOT NULL,
    UNIQUE ("userId", id),
    FOREIGN KEY ("userId", "projectId") REFERENCES project("userId", id)
  );
  CREATE TABLE document (
    id serial PRIMARY KEY,
    "userId" text NOT NULL,
    title text NOT NULL,
    source text,
    "mimeType" text NOT NULL DEFAULT 'text/plain',
    content text NOT NULL,
    "chunkCount" integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'indexed',
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now()
  );
  CREATE TABLE document_chunk (
    id serial PRIMARY KEY,
    "userId" text NOT NULL,
    "documentId" integer NOT NULL,
    "chunkIndex" integer NOT NULL,
    content text NOT NULL,
    embedding text,
    "createdAt" timestamp NOT NULL DEFAULT now()
  );
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

async function rollback(client: PoolClient) {
  try {
    await client.query("ROLLBACK")
  } catch {
    // A failed transaction may already be closed by connection teardown.
  }
}

runDatabase("historical private Project/Thread PostgreSQL contract", { timeout: 60_000 }, () => {
  it("rejects cross-Project Thread bindings and serializes chunk insertion against historical conversion", async () => {
    const schema = `historical_project_context_${randomUUID().replaceAll("-", "")}`
    const admin = new Pool({ connectionString: directDatabaseUrl(databaseUrl!), max: 1 })
    let pool: Pool | null = null
    let chunkClient: PoolClient | null = null
    let conversionClient: PoolClient | null = null

    try {
      await admin.query(`CREATE SCHEMA "${schema}"`)
      pool = new Pool({ connectionString: schemaDatabaseUrl(databaseUrl!, schema), max: 4 })
      await pool.query(prerequisiteDdl)
      await pool.query(readFileSync("migrations/0014-historical-knowledge-promotion.sql", "utf8"))
      await pool.query(`
        INSERT INTO project (id, "userId", key, name) VALUES
          (1, 'tenant-a', 'terrafusion', 'TerraFusion OS'),
          (2, 'tenant-a', 'williamos', 'WilliamOS');
        INSERT INTO workbench_thread (id, "userId", "projectId", title) VALUES
          ('thread-williamos', 'tenant-a', 2, 'WilliamOS Thread');
      `)

      const provenance = JSON.stringify({
        sourceCommit: "7664e589bddbe35ea4b9f8b72fad2cfbb9ffe7f7",
        sourceTree: "de4bdd48108d12c35ea3f53e3f8b7d032cf2b674",
        provenanceCommits: [
          "d45981428d30b1c35714ea12b886720deb766419",
          "a1a9cc2d7f37b4311aea698a86314c27f85e340e",
        ],
        rawSha256: "e48c899f0451267a595f383da66fcce1412fd03b0bea46161222b87fbddf6aec",
        blobId: "22b22c9be307b13a7a89d74b2c78a65f72cd72b5",
        disposition: "PROMOTE_AS_PROPOSED",
        privacy: "private",
        authority: "historical_non_authoritative",
        executionMode: "non_executing",
      })
      const crossProjectInsert = pool.query(`
        INSERT INTO document (
          id, "userId", title, source, content, "chunkCount", status,
          "projectId", "threadId", "historicalCandidateId", "historicalClaimId",
          "historicalProvenance", privacy, authority, "executionMode"
        ) VALUES (
          10, 'tenant-a', 'Private context', 'historical/private-project-context', 'adapted', 0,
          'private_project_context', 1, 'thread-williamos', 'HKR-eabf2e0c67a8a0f4', 'HKR004-C029',
          $1::jsonb, 'private', 'historical_non_authoritative', 'non_executing'
        )
      `, [provenance])
      await expect(crossProjectInsert).rejects.toMatchObject({
        code: "23503",
        constraint: "document_historical_user_project_thread_fk",
      })

      await pool.query(`
        INSERT INTO document (id, "userId", title, content, "chunkCount", status)
        VALUES (20, 'tenant-a', 'Ordinary', 'ordinary', 0, 'indexed')
      `)
      chunkClient = await pool.connect()
      conversionClient = await pool.connect()
      await chunkClient.query("BEGIN")
      await conversionClient.query("BEGIN")
      await chunkClient.query(`
        INSERT INTO document_chunk ("userId", "documentId", "chunkIndex", content, embedding)
        VALUES ('tenant-a', 20, 0, 'ordinary chunk', '[0.1]')
      `)

      const conversion = conversionClient.query(`
        UPDATE document SET
          title = 'Private context',
          source = 'historical/private-project-context',
          content = 'adapted',
          "chunkCount" = 0,
          status = 'private_project_context',
          "projectId" = 1,
          "historicalCandidateId" = 'HKR-eabf2e0c67a8a0f4',
          "historicalClaimId" = 'HKR004-C029',
          "historicalProvenance" = $1::jsonb,
          privacy = 'private',
          authority = 'historical_non_authoritative',
          "executionMode" = 'non_executing'
        WHERE id = 20
      `, [provenance])

      await new Promise((resolve) => setTimeout(resolve, 150))
      await chunkClient.query("COMMIT")
      chunkClient.release()
      chunkClient = null

      let conversionError: unknown = null
      try {
        await conversion
        await conversionClient.query("COMMIT")
      } catch (error) {
        conversionError = error
        await rollback(conversionClient)
      }
      conversionClient.release()
      conversionClient = null

      expect(conversionError).toMatchObject({
        message: expect.stringContaining("HISTORICAL_PROJECT_CONTEXT_CHUNK_FORBIDDEN"),
      })
      await expect(pool.query(`
        SELECT d.status, d."historicalCandidateId", count(dc.id)::integer AS chunks
        FROM document d
        LEFT JOIN document_chunk dc ON dc."documentId" = d.id
        WHERE d.id = 20
        GROUP BY d.id
      `)).resolves.toMatchObject({
        rows: [{ status: "indexed", historicalCandidateId: null, chunks: 1 }],
      })
      await expect(pool.query(`
        SELECT count(*)::integer AS residue
        FROM document d
        JOIN document_chunk dc ON dc."documentId" = d.id
        WHERE d."historicalCandidateId" IS NOT NULL
           OR d.status IN ('private_project_context', 'archived_private_project_context')
      `)).resolves.toMatchObject({ rows: [{ residue: 0 }] })
    } finally {
      if (chunkClient) {
        await rollback(chunkClient)
        chunkClient.release()
      }
      if (conversionClient) {
        await rollback(conversionClient)
        conversionClient.release()
      }
      await pool?.end()
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    }
  })
})
