/**
 * Builds the committed live-acceptance evidence artifact from the acceptance rollup.
 * Run from the lane root after `node C:/Users/bs/seam-acceptance.mjs` completes:
 *   node scripts/execution-fabric/gpu-tabular-bench/collect_dispatch_acceptance.cjs <rollup.json> <out.json>
 */
const fs = require("fs")

const [rollupPath, outPath] = process.argv.slice(2)
if (!rollupPath || !outPath) {
  console.log("USAGE: collect_dispatch_acceptance.cjs <rollup.json> <out.json>")
  process.exit(2)
}
const rollup = JSON.parse(fs.readFileSync(rollupPath, "utf8"))
const artifact = {
  schemaVersion: "williamos-gpu-tabular-dispatch-acceptance/1",
  promoted: false,
  runTag: rollup.runTag,
  generatedAt: rollup.generatedAt,
  host: "HERMES (dispatch) -> DAEDALUS (execution)",
  binding: { workerId: "daedalus-gpu-tabular", provider: "daedalus-cuml-rapids",
    runtime: "cuml 26.08.00 / cudf 26.08.01 / CUDA 13.4.49",
    environment: "/home/daedalus/.venvs/cuml-qual" },
  transport: "fabric SSH (pinned key + pinned known_hosts + strict host checking)",
  stateGuard: "real WO-MAO-021 lane-lease store + real WO-MAO-022 evidence ledger (fresh per run)",
  dataBoundary: "synthetic generation only (reviewed generators, shape + seed on the wire); no county/protected data",
  ok: rollup.passed === rollup.total,
  passed: rollup.passed,
  total: rollup.total,
  scenarios: rollup.results.map((entry) => ({
    name: entry.name,
    expect: entry.expect,
    pass: entry.ok === true,
    seconds: entry.seconds,
    detail: entry.detail ?? null,
    error: entry.error ?? null,
  })),
  note: "MEASURED live acceptance of the dispatch seam. Records what executed, where, and what the "
    + "owner-facing projection received. Promotion of the capability remains the reviewed registry "
    + "transition in this repository's capability records.",
}
fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n")
console.log(`${artifact.passed}/${artifact.total} pass -> ${outPath}`)
process.exitCode = artifact.ok ? 0 : 1
