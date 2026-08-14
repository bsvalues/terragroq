#!/usr/bin/env node
// Explicit, tenant-bound P1 Project backfill. Dry-run by default; live writes require
// both DATABASE_URL and WILLIAMOS_PROJECT_BACKFILL_APPLY=1. No inferred memberships.
import path from "node:path"
import { pathToFileURL } from "node:url"

const PROJECTS = [
  { key: "williamos", name: "WilliamOS", lifecycle: "active" },
  { key: "terrafusion", name: "TerraFusion OS", lifecycle: "standby" },
]

const RESOURCES = [
  {
    projectKey: "williamos",
    type: "repo",
    canonicalIdentity: "bsvalues/terragroq",
    label: "WilliamOS repo",
    relationship: "primary-repo",
  },
  {
    projectKey: "terrafusion",
    type: "repo",
    canonicalIdentity: "bsvalues/terrafusion_os_1.0",
    label: "TerraFusion OS repo",
    relationship: "primary-repo",
  },
]

export function buildProjectBackfill(userId) {
  const tenant = String(userId ?? "").trim()
  if (!tenant) throw new Error("PROJECT_BACKFILL_USER_ID_REQUIRED")
  return { userId: tenant, projects: PROJECTS.map((row) => ({ ...row })), resources: RESOURCES.map((row) => ({ ...row })) }
}

export async function applyProjectBackfill({ client, plan }) {
  await client.query("BEGIN")
  try {
    const user = await client.query('select 1 from "user" where "id" = $1', [plan.userId])
    if (user.rowCount !== 1) throw new Error("PROJECT_BACKFILL_USER_NOT_FOUND")

    const projectIds = new Map()
    for (const row of plan.projects) {
      const inserted = await client.query(
        'insert into "project" ("userId","key","name","lifecycle") values ($1,$2,$3,$4) on conflict ("userId","key") do nothing returning "id"',
        [plan.userId, row.key, row.name, row.lifecycle],
      )
      const existing = inserted.rows[0] ?? (
        await client.query('select "id" from "project" where "userId" = $1 and "key" = $2', [plan.userId, row.key])
      ).rows[0]
      if (!existing) throw new Error(`PROJECT_BACKFILL_PROJECT_UNRESOLVED:${row.key}`)
      projectIds.set(row.key, existing.id)
    }

    for (const row of plan.resources) {
      const projectId = projectIds.get(row.projectKey)
      if (!projectId) throw new Error(`PROJECT_BACKFILL_PROJECT_UNRESOLVED:${row.projectKey}`)
      await client.query(
        'insert into "project_resource" ("userId","projectId","type","canonicalIdentity","label","relationship") values ($1,$2,$3,$4,$5,$6) on conflict ("projectId","type","canonicalIdentity","relationship") do nothing',
        [plan.userId, projectId, row.type, row.canonicalIdentity, row.label, row.relationship],
      )
    }

    const counts = await client.query(
      'select (select count(*)::int from "project" where "userId" = $1 and "key" = any($2::text[])) as projects, (select count(*)::int from "project_resource" where "userId" = $1 and "projectId" = any($3::int[])) as resources',
      [plan.userId, plan.projects.map((row) => row.key), [...projectIds.values()]],
    )
    await client.query("COMMIT")
    return { status: "APPLIED", projects: counts.rows[0].projects, resources: counts.rows[0].resources }
  } catch (error) {
    try {
      await client.query("ROLLBACK")
    } catch {
      // Surface the original failure.
    }
    throw error
  }
}

async function main() {
  const plan = buildProjectBackfill(process.env.WILLIAMOS_PROJECT_BACKFILL_USER_ID)
  if (process.env.WILLIAMOS_PROJECT_BACKFILL_APPLY !== "1") {
    console.log(JSON.stringify({ status: "DRY_RUN", projects: plan.projects.length, resources: plan.resources.length }))
    return
  }
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim()
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED")
  const { Client } = await import("pg")
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    console.log(JSON.stringify(await applyProjectBackfill({ client, plan })))
  } finally {
    await client.end()
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
