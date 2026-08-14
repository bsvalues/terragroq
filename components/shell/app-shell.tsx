import { AppShellFrame } from "./app-shell-frame"
import { getActivity } from "@/lib/operator/activity"
import { getOperatorState } from "@/lib/operator/operator-state"
import { buildWorkbenchModel } from "@/lib/workbench/workbench-model"

export async function AppShell({ user, children }: { user: { name: string; email: string }; children: React.ReactNode }) {
  const [state, activity] = await Promise.all([getOperatorState(), getActivity()])
  return <AppShellFrame user={user} model={buildWorkbenchModel(state, activity)}>{children}</AppShellFrame>
}
