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
    resourceKey: "williamos",
    role: "integrated-runtime",
    previewSource: true,
  },
  {
    projectKey: "terrafusion",
    type: "repo",
    canonicalIdentity: "bsvalues/terrafusion_os_1.0",
    label: "OS 1.0",
    relationship: "primary-repo",
    resourceKey: "os-1",
    role: "integrated-runtime",
    previewSource: true,
  },
  {
    projectKey: "terrafusion",
    type: "repo",
    canonicalIdentity: "bsvalues/terrafusion-os",
    label: "Sovereign OS",
    relationship: "sovereign-planning-and-promotion",
    resourceKey: "sovereign-os",
    role: "sovereign-planning-and-promotion",
    previewSource: false,
  },
  {
    projectKey: "terrafusion",
    type: "repo",
    canonicalIdentity: "bsvalues/terrafusion-forge",
    label: "Forge",
    relationship: "suite-source",
    resourceKey: "forge",
    role: "suite-source",
    previewSource: false,
  },
  {
    projectKey: "terrafusion",
    type: "repo",
    canonicalIdentity: "bsvalues/terrafusion-atlas",
    label: "Atlas",
    relationship: "suite-source",
    resourceKey: "atlas",
    role: "suite-source",
    previewSource: false,
  },
  {
    projectKey: "terrafusion",
    type: "repo",
    canonicalIdentity: "bsvalues/terrafusion-dais",
    label: "Dais",
    relationship: "suite-source",
    resourceKey: "dais",
    role: "suite-source",
    previewSource: false,
  },
  {
    projectKey: "terrafusion",
    type: "repo",
    canonicalIdentity: "bsvalues/terrafusion-dossier",
    label: "Dossier",
    relationship: "suite-source",
    resourceKey: "dossier",
    role: "suite-source",
    previewSource: false,
  },
  {
    projectKey: "terrafusion",
    type: "repo",
    canonicalIdentity: "bsvalues/terrafusion-gpt",
    label: "GPT",
    relationship: "suite-source",
    resourceKey: "gpt",
    role: "suite-source",
    previewSource: false,
  },
]

export function buildCanonicalOwnerProjectPlan(userId) {
  const tenant = String(userId ?? "").trim()
  if (!tenant) throw new Error("PROJECT_BACKFILL_USER_ID_REQUIRED")
  return {
    userId: tenant,
    projects: PROJECTS.map((row) => ({ ...row })),
    resources: RESOURCES.map((row) => ({ ...row })),
  }
}

export async function applyCanonicalOwnerProjectPlan({ client, plan }) {
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
        'insert into "project_resource" ("userId","projectId","type","canonicalIdentity","label","relationship","resourceKey") values ($1,$2,$3,$4,$5,$6,$7) on conflict ("projectId","type","canonicalIdentity","relationship") do update set "label" = excluded."label", "resourceKey" = excluded."resourceKey", "updatedAt" = now()',
        [plan.userId, projectId, row.type, row.canonicalIdentity, row.label, row.relationship, row.resourceKey],
      )
      const persisted = row.relationship === "primary-repo"
        ? await client.query(
          'select "canonicalIdentity","resourceKey" from "project_resource" where "userId" = $1 and "projectId" = $2 and "type" = $3 and "relationship" = $4',
          [plan.userId, projectId, row.type, row.relationship],
        )
        : await client.query(
          'select "canonicalIdentity","resourceKey" from "project_resource" where "userId" = $1 and "projectId" = $2 and "type" = $3 and "canonicalIdentity" = $4 and "relationship" = $5 and "resourceKey" = $6',
          [plan.userId, projectId, row.type, row.canonicalIdentity, row.relationship, row.resourceKey],
        )
      if (
        persisted.rowCount !== 1
        || persisted.rows[0]?.canonicalIdentity !== row.canonicalIdentity
        || persisted.rows[0]?.resourceKey !== row.resourceKey
      ) {
        const conflict = row.relationship === "primary-repo"
          ? `PROJECT_BACKFILL_PRIMARY_REPO_CONFLICT:${row.projectKey}`
          : `PROJECT_BACKFILL_RESOURCE_CONFLICT:${row.projectKey}:${row.resourceKey}`
        throw new Error(conflict)
      }
    }

    await client.query("COMMIT")
    return { status: "APPLIED", projects: projectIds.size, resources: plan.resources.length }
  } catch (error) {
    try {
      await client.query("ROLLBACK")
    } catch {
      // Surface the provisioning failure, not a secondary rollback failure.
    }
    throw error
  }
}
