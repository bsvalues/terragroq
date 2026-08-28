/**
 * The operations the cockpit is allowed to actually run.
 *
 * This file is the deliberate authority expansion that `lib/governance/execute-guard.ts` anticipated:
 * EXECUTE_LOOP_V1 forbade the application from running anything at all, which is why every surface
 * could only render rows a background process had already written. A tool the operator cannot act
 * through is a report, not a tool.
 *
 * The expansion is narrow on purpose. An operation is a FIXED argv chosen from this catalogue by id.
 * No operator text is ever concatenated into a command, and nothing is executed through a shell, so
 * there is no interpolation point to escape from -- the browser can pick from this list and nothing
 * else. Operations that change something are marked `mutating` and the caller must say so explicitly,
 * so a read cannot silently become a write.
 */

export type LoomOperationId =
  | "repo.status"
  | "repo.diff"
  | "repo.log"
  | "tests.run"
  | "build.run"
  | "service.status"
  | "service.logs"
  | "service.restart"

export interface LoomOperation {
  id: LoomOperationId
  label: string
  /** What the operator is about to cause, in their words, not the command's. */
  intent: string
  /** Executable name resolved against PATH; never operator-supplied. */
  command: string
  args: readonly string[]
  /** "project" = the checkout, "runtime" = the deployed cockpit. */
  scope: "project" | "runtime"
  /** True when running this changes state rather than just reporting it. */
  mutating: boolean
  timeoutMs: number
  /** Exact human-facing command accepted by the Project Terminal; never parsed as argv. */
  terminalAlias?: string
}

export const LOOM_OPERATIONS: readonly LoomOperation[] = [
  {
    id: "repo.status",
    label: "What has changed",
    intent: "List the files currently modified in the working tree.",
    command: "git",
    args: ["status", "--short", "--branch"],
    scope: "project",
    mutating: false,
    timeoutMs: 60_000,
    terminalAlias: "git status",
  },
  {
    id: "repo.diff",
    label: "Show diff summary",
    intent: "Show the full diff of the working tree against HEAD.",
    command: "git",
    args: ["diff", "--stat", "HEAD"],
    scope: "project",
    mutating: false,
    timeoutMs: 60_000,
    terminalAlias: "git diff",
  },
  {
    id: "repo.log",
    label: "Recent history",
    intent: "Show the last twenty commits on this branch.",
    command: "git",
    args: ["log", "--oneline", "--decorate", "-20"],
    scope: "project",
    mutating: false,
    timeoutMs: 60_000,
    terminalAlias: "git log",
  },
  {
    id: "tests.run",
    label: "Run the tests",
    intent: "Run the full vitest suite and stream its output.",
    // node is spawned directly rather than through pnpm: Windows refuses to run .cmd shims without
    // a shell, and introducing a shell would create the interpolation point this design avoids.
    command: "node",
    args: ["node_modules/vitest/vitest.mjs", "run", "--reporter=basic"],
    scope: "project",
    mutating: false,
    timeoutMs: 20 * 60_000,
    terminalAlias: "test",
  },
  {
    id: "build.run",
    label: "Build the app",
    intent: "Run a production Next.js build and stream its output.",
    command: "node",
    args: ["node_modules/next/dist/bin/next", "build"],
    scope: "project",
    mutating: false,
    timeoutMs: 20 * 60_000,
    terminalAlias: "build",
  },
  {
    id: "service.status",
    label: "Is the cockpit healthy",
    intent: "Report whether the app and HTTPS listener are running and listening.",
    command: "powershell",
    args: [
      "-NoProfile",
      "-Command",
      "Get-ScheduledTask -TaskName 'WilliamOS Live','WilliamOS HTTPS' | ForEach-Object { \"{0}: {1}\" -f $_.TaskName, $_.State }; Get-NetTCPConnection -State Listen -LocalPort 3100,3443 -ErrorAction SilentlyContinue | ForEach-Object { \"listening {0}:{1}\" -f $_.LocalAddress, $_.LocalPort }",
    ],
    scope: "runtime",
    mutating: false,
    timeoutMs: 120_000,
  },
  {
    id: "service.logs",
    label: "Show the cockpit log",
    intent: "Show the last 200 lines the running cockpit has written.",
    command: "powershell",
    args: [
      "-NoProfile",
      "-Command",
      "Get-Content 'C:\\ProgramData\\WilliamOS\\logs\\williamos-live.stderr.log' -Tail 200 -ErrorAction SilentlyContinue",
    ],
    scope: "runtime",
    mutating: false,
    timeoutMs: 120_000,
  },
  {
    id: "service.restart",
    label: "Restart the cockpit",
    intent: "Stop and restart the app and HTTPS listener. Sessions survive; in-flight requests do not.",
    command: "powershell",
    args: [
      "-NoProfile",
      "-Command",
      "Stop-ScheduledTask -TaskName 'WilliamOS Live','WilliamOS HTTPS'; Start-Sleep -Seconds 2; Start-ScheduledTask -TaskName 'WilliamOS Live'; Start-ScheduledTask -TaskName 'WilliamOS HTTPS'; 'restart requested'",
    ],
    scope: "runtime",
    mutating: true,
    timeoutMs: 120_000,
  },
] as const

export function findLoomOperation(id: unknown): LoomOperation | null {
  if (typeof id !== "string") return null
  return LOOM_OPERATIONS.find((operation) => operation.id === id) ?? null
}

/** Resolve one whole alias to an existing non-mutating project operation. No token is parsed. */
export function resolveProjectTerminalAlias(input: unknown): LoomOperation | null {
  if (typeof input !== "string") return null
  const alias = input.trim()
  return LOOM_OPERATIONS.find((operation) => (
    operation.scope === "project"
    && operation.mutating === false
    && operation.terminalAlias === alias
  )) ?? null
}

export type LoomOperationRefusal = "UNKNOWN_OPERATION" | "CONFIRMATION_REQUIRED"

export interface LoomOperationResolution {
  ok: boolean
  operation?: LoomOperation
  refusal?: LoomOperationRefusal
}

/**
 * Resolve a requested operation, refusing anything not in the catalogue.
 *
 * A mutating operation additionally requires the caller to have confirmed it. That check lives here
 * rather than in the UI so it cannot be skipped by calling the endpoint directly.
 */
export function resolveLoomOperation(id: unknown, { confirmed = false } = {}): LoomOperationResolution {
  const operation = findLoomOperation(id)
  if (!operation) return { ok: false, refusal: "UNKNOWN_OPERATION" }
  if (operation.mutating && confirmed !== true) return { ok: false, refusal: "CONFIRMATION_REQUIRED", operation }
  return { ok: true, operation }
}
