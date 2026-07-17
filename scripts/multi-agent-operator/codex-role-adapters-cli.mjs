#!/usr/bin/env node

const [inputPath, ...extra] = process.argv.slice(2)

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

const usageFailure = !inputPath || extra.length > 0
const result = {
  schemaVersion: 2,
  artifactType: "CODEX_ROLE_ADAPTER_CLI_RESULT",
  ok: false,
  code: usageFailure ? "CODEX_ROLE_CLI_USAGE_WALL" : "CODEX_ROLE_CLI_PRIVATE_SESSION_WALL",
  field: usageFailure ? "inputPath" : "roleLifecycle",
  detail: usageFailure ? null : "OPAQUE_CURRENT_SESSION_PLAN_AND_ASSIGNMENT_HANDLES_REQUIRED",
  nativeAssignmentsStarted: 0,
  ownerRelayRequired: false,
  runtimeActivationAllowed: false,
  localIssue357Allowed: false,
  authorityGranted: false,
}

process.stdout.write(`${JSON.stringify(canonical(result))}\n`)
process.exitCode = 2
