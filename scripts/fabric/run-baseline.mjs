#!/usr/bin/env node
/**
 * Run the fabric baseline gate headlessly.
 *
 * #827's acceptance is a real 4/4, produced by whoever is finishing the enrolment lane. Until now the
 * only caller was the session-gated route, so the lane's last step was "ask the owner to press the
 * button" -- which is not an acceptance, it is a handoff. This is the same gate with no browser in
 * the way.
 *
 *   node scripts/fabric/run-baseline.mjs                 all nodes, human-readable
 *   node scripts/fabric/run-baseline.mjs --node omen     one node
 *   node scripts/fabric/run-baseline.mjs --json          machine-readable, for evidence capture
 *
 * Exit code is 1 unless every probed node passes every step, so it can gate a script.
 */
import { readRegistry, runAllBaselines, summarise, BASELINE_STEP_IDS } from "../../lib/fabric/run-baseline.mjs"

function parseArgs(argv) {
  const only = []
  let json = false
  let fabricRoot
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--json") json = true
    else if (argv[i] === "--node") only.push(argv[++i])
    else if (argv[i] === "--fabric-root") fabricRoot = argv[++i]
    else {
      console.error(`unknown argument: ${argv[i]}`)
      process.exit(2)
    }
  }
  return { only, json, fabricRoot }
}

const { only, json, fabricRoot } = parseArgs(process.argv.slice(2))

let registry
try {
  registry = await readRegistry(fabricRoot)
} catch (error) {
  console.error(`REGISTRY_UNAVAILABLE: ${error?.message ?? error}`)
  process.exit(2)
}

if (only.length > 0) {
  const unknown = only.filter((name) => !(name in registry))
  if (unknown.length > 0) {
    console.error(`unknown node(s): ${unknown.join(", ")} -- registry has ${Object.keys(registry).join(", ")}`)
    process.exit(2)
  }
  registry = Object.fromEntries(Object.entries(registry).filter(([name]) => only.includes(name)))
}

const run = await runAllBaselines(registry, fabricRoot ? { fabricRoot } : {})
const summary = summarise(run)

if (json) {
  console.log(JSON.stringify({ ...run, summary }, null, 2))
} else {
  const width = Math.max(...summary.nodes.map((n) => n.node.length), 4)
  console.log(`fabric baseline -- ${run.ranAt}\n`)
  console.log(`${"node".padEnd(width)}  ${BASELINE_STEP_IDS.map((id) => id.padEnd(10)).join("")}`)
  for (const node of summary.nodes) {
    const cells = BASELINE_STEP_IDS.map((id) => {
      const step = node.steps.find((s) => s.step === id)
      return (step ? (step.ok ? "ok" : "FAIL") : "-").padEnd(10)
    })
    console.log(`${node.node.padEnd(width)}  ${cells.join("")}`)
  }
  console.log("")
  for (const node of summary.nodes) {
    if (node.passed) continue
    const failure = node.firstFailure
    console.log(`${node.node}: FAILED at "${failure?.step ?? "?"}" -- ${failure?.detail || "no detail"}`)
  }
  console.log(`\n${summary.passedCount}/${summary.total} nodes pass the baseline.`)
}

process.exit(summary.passedCount === summary.total ? 0 : 1)
