import { pool } from "@/lib/db"
import {
  applyCanonicalOwnerProjectPlan,
  buildCanonicalOwnerProjectPlan,
} from "@/lib/projects/canonical-owner-projects.mjs"

type OwnerProjectProvisioningClient = Readonly<{
  query: (
    text: string,
    values?: readonly unknown[],
  ) => Promise<Readonly<{ rowCount: number | null; rows: readonly Record<string, unknown>[] }>>
  release: () => void
}>

export type OwnerProjectProvisioningDependencies = Readonly<{
  connect: () => Promise<OwnerProjectProvisioningClient>
}>

const dependencies: OwnerProjectProvisioningDependencies = {
  async connect() {
    const client = await pool.connect()
    return {
      query: (text, values) => client.query(text, values ? [...values] : undefined),
      release: () => client.release(),
    }
  },
}

/**
 * Ensure the authenticated owner has WilliamOS's two canonical Project records before the working
 * environment renders. This consumes only server-owned product identity; it cannot accept or widen
 * a browser-authored repository binding.
 */
export async function ensureCanonicalOwnerProjects(
  userId: string,
  seams: OwnerProjectProvisioningDependencies = dependencies,
) {
  const client = await seams.connect()
  try {
    return await applyCanonicalOwnerProjectPlan({
      client,
      plan: buildCanonicalOwnerProjectPlan(userId),
    })
  } finally {
    client.release()
  }
}
