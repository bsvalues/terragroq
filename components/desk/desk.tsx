"use client"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import type { SummonedSurface } from "@/lib/environment/summon"

/** The root is one durable Space: independent work windows plus the transient universal Line. */
export function Desk({ initialSummon = null }: { initialSummon?: SummonedSurface | null } = {}) {
  return <WorkspaceShell initialSummon={initialSummon} />
}
