export type WorkOrderDraftPacketInput = {
  title: string
  goal: string
  lane: string
  phase: string
  scope: string
  nonGoals: string
  allowedFiles: string
  forbiddenFiles: string
  validators: string
  stopConditions: string
  acceptanceCriteria: string
  loop: string
  priority: string
  assignee: string
  authorityLevel: string
  agent: string
}

function valueOrPlaceholder(value: string, placeholder = "not set") {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : placeholder
}

export function buildWorkOrderDraftPacket(input: WorkOrderDraftPacketInput): string {
  return [
    "WORK_ORDER_DRAFT_REVIEW",
    `TITLE: ${valueOrPlaceholder(input.title)}`,
    `GOAL: ${valueOrPlaceholder(input.goal)}`,
    `LANE: ${valueOrPlaceholder(input.lane)}`,
    `PHASE: ${valueOrPlaceholder(input.phase)}`,
    `PRIORITY: ${valueOrPlaceholder(input.priority)}`,
    `ASSIGNEE: ${valueOrPlaceholder(input.assignee)}`,
    `AUTHORITY_REQUESTED: ${valueOrPlaceholder(input.authorityLevel)}`,
    `AGENT: ${input.agent === "none" ? "not assigned" : valueOrPlaceholder(input.agent)}`,
    "",
    "SCOPE:",
    valueOrPlaceholder(input.scope),
    "",
    "NON_GOALS:",
    valueOrPlaceholder(input.nonGoals),
    "",
    "ALLOWED_FILES:",
    valueOrPlaceholder(input.allowedFiles),
    "",
    "FORBIDDEN_FILES:",
    valueOrPlaceholder(input.forbiddenFiles),
    "",
    "VALIDATORS:",
    valueOrPlaceholder(input.validators),
    "",
    "ACCEPTANCE_CRITERIA:",
    valueOrPlaceholder(input.acceptanceCriteria),
    "",
    "STOP_CONDITIONS:",
    valueOrPlaceholder(input.stopConditions),
    "",
    "LOOP:",
    valueOrPlaceholder(input.loop),
    "",
    "AUTHORITY_NOTE:",
    "This draft records intent only. It does not approve execution, commit, push, release, deployment, auth changes, env changes, or database mutation.",
  ].join("\n")
}
