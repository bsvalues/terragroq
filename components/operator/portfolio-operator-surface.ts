import { getPortfolioOperatorProgram } from "@/components/operator/portfolio-operator-registry"
import { buildWorkOrderChain, resolveNextPortfolioProgram } from "@/components/operator/portfolio-operator-resolver"

export function getPortfolioOperatorSurface() {
  const portfolio = getPortfolioOperatorProgram()
  const selection = resolveNextPortfolioProgram(portfolio.backlog)
  const selected = portfolio.backlog.find((program) => program.programId === selection.programId) ?? portfolio.backlog[0]
  const workOrders = buildWorkOrderChain(selected)

  return {
    eyebrow: "GOAL-PORTFOLIO-OPERATOR-001",
    title: "Portfolio Operator",
    description: "Completed programs route to the highest-priority approved executable program. The Primary is involved only at a true authority wall.",
    selection,
    selectedProgram: selected,
    activeWorkOrder: workOrders[0],
    backlog: portfolio.backlog,
    controls: [] as never[],
    safety: portfolio.safety,
  }
}
