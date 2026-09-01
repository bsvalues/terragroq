#!/usr/bin/env node
// Explicit, tenant-bound P1 Project backfill. Dry-run by default; live writes require
// both DATABASE_URL and WILLIAMOS_PROJECT_BACKFILL_APPLY=1. No inferred memberships.
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  applyCanonicalOwnerProjectPlan,
  buildCanonicalOwnerProjectPlan,
} from "../../lib/projects/canonical-owner-projects.mjs"

export const buildProjectBackfill = buildCanonicalOwnerProjectPlan
export const applyProjectBackfill = applyCanonicalOwnerProjectPlan

async function main() {
  const plan = buildCanonicalOwnerProjectPlan(process.env.WILLIAMOS_PROJECT_BACKFILL_USER_ID)
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
    console.log(JSON.stringify(await applyCanonicalOwnerProjectPlan({ client, plan })))
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
