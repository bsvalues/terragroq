"use client"

import type { WorkbenchModel } from "@/lib/workbench/workbench-model"
import { WorkbenchShell } from "@/components/workbench/workbench-shell"

export function AppShellFrame({ user, model, children }: { user: { name: string; email: string }; model: WorkbenchModel; children: React.ReactNode }) {
  return <WorkbenchShell user={user} model={model}>{children}</WorkbenchShell>
}
