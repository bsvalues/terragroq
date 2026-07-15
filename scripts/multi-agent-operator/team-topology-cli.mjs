#!/usr/bin/env node

import fs from "node:fs"
import process from "node:process"

import {
  TeamTopologyError,
  compileTeamTopology,
} from "./team-topology.mjs"

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(canonicalize(value))}\n`)
}

try {
  if (process.argv.length !== 3) {
    throw new TeamTopologyError("TEAM_TOPOLOGY_CLI_WALL", "argv", "ONE_JSON_FILE_REQUIRED")
  }
  let input
  try {
    input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
  } catch {
    throw new TeamTopologyError("TEAM_TOPOLOGY_INPUT_WALL", "file", "READABLE_JSON_REQUIRED")
  }
  emit({ ok: true, ...compileTeamTopology(input) })
} catch (error) {
  const typed = error instanceof TeamTopologyError
    ? error
    : new TeamTopologyError("TEAM_TOPOLOGY_ASSERTION_WALL", "internal")
  emit({
    ok: false,
    code: typed.code,
    field: typed.field,
    detail: typed.detail ?? null,
  })
  process.exitCode = 2
}
