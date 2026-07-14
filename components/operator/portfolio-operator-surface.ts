import { getPortfolioOperatorProgram } from "@/components/operator/portfolio-operator-registry"
import { buildLoopPacket, buildWorkOrderChain, resolveNextPortfolioProgram } from "@/components/operator/portfolio-operator-resolver"

export function getPortfolioOperatorSurface(portfolio = getPortfolioOperatorProgram()) {
  const selection = resolveNextPortfolioProgram([...portfolio.completedPrograms, ...portfolio.backlog])
  const selected = portfolio.backlog.find((program) => program.programId === selection.programId) ?? null
  const workOrders = selected ? buildWorkOrderChain(selected) : []
  const activeWorkOrderId = selected ? buildLoopPacket(selected).activeWorkOrder : null

  return {
    eyebrow: "GOAL-PORTFOLIO-OPERATOR-001",
    title: "Portfolio Operator",
    description: "Completed programs route to the highest-priority approved executable program. The Primary is involved only at a true authority wall.",
    selection,
    selectedProgram: selected,
    activeWorkOrder: workOrders.find((workOrder) => workOrder.workOrderId === activeWorkOrderId) ?? null,
    backlog: portfolio.backlog,
    controls: [] as never[],
    safety: portfolio.safety,
  }
}
