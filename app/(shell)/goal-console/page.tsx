import { PageHeader } from "@/components/shell/page-header"
import { GoalConsoleView } from "@/components/goal-console/goal-console-view"
import { GoalNativeConceptPanel } from "@/components/goal-console/goal-native-concept-panel"
import { LoopNativeConceptPanel } from "@/components/goal-console/loop-native-concept-panel"
import { ProductionOperatingModePanel } from "@/components/dogfood/production-operating-mode-panel"
import { WorkTrainingCapturePanel } from "@/components/dogfood/work-training-capture-panel"
import { CodexOperatorPanel } from "@/components/operator/codex-operator-panel"
import { PortfolioOperatorPanel } from "@/components/operator/portfolio-operator-panel"
import { getGoals, getCurrentTruth } from "@/app/actions/goals"

export default async function GoalConsolePage() {
  const [goals, truth] = await Promise.all([getGoals(), getCurrentTruth()])

  return (
    <>
      <PageHeader
        title="Goal Console"
        description="State a goal. The console classifies it, checks it against doctrine and known mistake patterns, and drafts a work order. It never executes — read-only by design."
      />
      <div className="flex flex-col gap-4 px-6 pb-2">
        <PortfolioOperatorPanel />
        <CodexOperatorPanel />
        <ProductionOperatingModePanel />
        <WorkTrainingCapturePanel />
        <GoalNativeConceptPanel />
        <LoopNativeConceptPanel />
      </div>
      <GoalConsoleView initialGoals={goals} truth={truth} />
    </>
  )
}
