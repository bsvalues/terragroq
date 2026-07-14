#!/usr/bin/env node
import fs from "node:fs"

import { HostedTeamPlanError, planHostedTeamWave } from "./hosted-team-plan.mjs"

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

if (process.argv.length !== 3) {
  emit({ ok: false, code: "HOSTED_TEAM_PLAN_CLI_USAGE_WALL" })
  process.exitCode = 2
} else {
  try {
    const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
    emit({ ok: true, ...planHostedTeamWave(input) })
  } catch (error) {
    emit({
      ok: false,
      code: error instanceof HostedTeamPlanError ? error.code : "HOSTED_TEAM_PLAN_INPUT_WALL",
      detail: error instanceof HostedTeamPlanError ? error.detail : "unreadable-or-invalid-json",
    })
    process.exitCode = 2
  }
}
