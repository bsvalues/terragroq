#!/usr/bin/env node

import fs from "node:fs"
import process from "node:process"

import {
  IsolatedWorkspaceManagerError,
  canonicalIsolatedWorkspaceJson,
  executeIsolatedWorkspaceLifecycle,
  planIsolatedWorkspaces,
} from "./isolated-workspace-manager.mjs"

function emit(value) {
  process.stdout.write(`${canonicalIsolatedWorkspaceJson(value)}\n`)
}

try {
  if (process.argv.length !== 4 || !["plan", "apply"].includes(process.argv[2])) {
    throw new IsolatedWorkspaceManagerError(
      "ISOLATED_WORKSPACE_CLI_WALL",
      "argv",
      "PLAN_OR_APPLY_AND_ONE_JSON_FILE_REQUIRED",
    )
  }
  let input
  try {
    input = JSON.parse(fs.readFileSync(process.argv[3], "utf8"))
  } catch {
    throw new IsolatedWorkspaceManagerError(
      "ISOLATED_WORKSPACE_INPUT_WALL",
      "file",
      "READABLE_JSON_REQUIRED",
    )
  }
  emit({
    ok: true,
    ...(process.argv[2] === "apply"
      ? executeIsolatedWorkspaceLifecycle(input)
      : planIsolatedWorkspaces(input)),
  })
} catch (error) {
  const typed = error instanceof IsolatedWorkspaceManagerError
    ? error
    : new IsolatedWorkspaceManagerError("ISOLATED_WORKSPACE_ASSERTION_WALL", "internal")
  emit({
    ok: false,
    code: typed.code,
    field: typed.field,
    detail: typed.detail ?? null,
    planningOnly: true,
    localContractOnly: true,
    gitCommandPerformed: false,
    filesystemMutationPerformed: false,
    executionPerformed: false,
    mutationPerformed: false,
    cleanupPerformed: false,
    executionAuthorized: false,
    authorityGranted: false,
  })
  process.exitCode = 2
}
