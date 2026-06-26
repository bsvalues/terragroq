import { PageHeader } from "@/components/shell/page-header"
import { GoalConsoleView } from "@/components/goal-console/goal-console-view"
import { getGoals, getCurrentTruth } from "@/app/actions/goals"

export default async function GoalConsolePage() {
  const [goals, truth] = await Promise.all([getGoals(), getCurrentTruth()])

  return (
    <>
      <PageHeader
        title="Goal Console"
        description="State a goal. The console classifies it, checks it against doctrine and known mistake patterns, and drafts a work order. It never executes — read-only by design."
      />
      <GoalConsoleView initialGoals={goals} truth={truth} />
    </>
  )
}
