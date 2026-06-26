// WO-012 — Lock Execute Loop to Non-Mutating V1.
//
// The execute loop is a GOVERNED PLANNING surface, not an executor. In V1 it may:
//   - create planned action records
//   - mark required mutations
//   - request escalation
// It may NOT:
//   - run shell commands
//   - write source files
//   - commit / push / tag / release
//
// This guard makes that boundary explicit and testable. Any request that would
// mutate returns ESCALATION_NEEDED. A future authority expansion would replace
// V1 deliberately — never by a developer quietly wiring EXECUTE_LOOP to a shell.

export const EXECUTE_LOOP_VERSION = "EXECUTE_LOOP_V1" as const

export const EXECUTE_LOOP_V1_CAPABILITIES = {
  may: ["create planned action records", "mark required mutations", "request escalation"],
  mayNot: [
    "run shell commands",
    "write source files",
    "commit",
    "push",
    "tag",
    "release",
  ],
} as const

export type ExecuteVerdict = "PLAN_RECORD" | "ESCALATION_NEEDED"

export interface ExecuteGuardResult {
  verdict: ExecuteVerdict
  // True only for non-mutating planning/recording requests.
  allowed: boolean
  reason: string
  matched?: string
}

// Signals that a requested execute-loop action would actually mutate state.
const MUTATION_SIGNALS: string[] = [
  "shell",
  "bash",
  "sh -c",
  "exec(",
  "execsync",
  "spawn",
  "child_process",
  "run command",
  "run a command",
  "git commit",
  "git push",
  "git tag",
  "git merge",
  "commit",
  "push",
  "tag",
  "deploy",
  "release",
  "write file",
  "writefile",
  "fs.write",
  "edit file",
  "modify file",
  "delete",
  "rm -",
  "drop table",
  "truncate",
  "migrate",
  "npm publish",
]

// Classify a requested execute-loop action. Mutations are never permitted in V1;
// they return ESCALATION_NEEDED so authority must be expanded deliberately.
export function guardExecuteAction(action: string): ExecuteGuardResult {
  const text = (action ?? "").toLowerCase()
  const matched = MUTATION_SIGNALS.find((s) => text.includes(s))
  if (matched) {
    return {
      verdict: "ESCALATION_NEEDED",
      allowed: false,
      reason: `Execute loop is non-mutating (${EXECUTE_LOOP_VERSION}). "${matched}" requires explicit authority escalation.`,
      matched,
    }
  }
  return {
    verdict: "PLAN_RECORD",
    allowed: true,
    reason: `Recorded as a governed planning action under ${EXECUTE_LOOP_VERSION}.`,
  }
}
