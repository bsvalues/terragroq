import crypto from "node:crypto"

import { auditFabricAction } from "./audit.mjs"
import { brokeredExec } from "./broker.mjs"
import { defaultExec, defaultFabricRoot, meaningfulSshError } from "./transport.mjs"

/**
 * The baseline gate's executor, extracted from the API route so it has more than one way in.
 *
 * #829 gave the gate a button, which made it owner-visible. It also, unintentionally, made the gate
 * owner-*dependent*: the only caller was a session-gated POST handler, so an agent finishing the
 * enrolment lane had nothing to invoke and could only report "ready for you to press". Observability
 * and execution authority are different things, and collapsing them turned an affordance into a
 * blocker. The route keeps its button; this module gives the same six steps a headless entry point.
 *
 * The step semantics live in `baseline.ts` alongside the UI types. They are restated here because a
 * `.mjs` module cannot import the `.ts` one without a build step, and `tests/fabric-baseline-runner`
 * pins the two copies equal -- a drifting gate would silently change what "4/4" means.
 *
 * THE RAW TRANSPORT THIS FILE USED TO OWN IS GONE (`CONT-EXPV2-BASELINE-RAW-TRANSPORT`). `sh()`
 * called `exec("powershell", ...)` and `exec("ssh", sshArgs(...))` directly, which made this gate --
 * the thing that starts a workload, transfers a file and force-stops the workload on EVERY node in
 * the registry -- the one caller the broker never saw. No unknown-node refusal, and no ledger entry
 * the gate could not swallow.
 *
 * It was not fixable in place. `broker.mjs` imported its transport from this file, so calling the
 * broker from here would have closed an import cycle; the defect was held in place by the layering
 * rather than by anyone's choice. `transport.mjs` now owns the primitives both modules need, and
 * every node command below goes through `brokeredExec` like every other caller in the repository.
 *
 * The transport primitives are re-exported unchanged, because the broker, the node probe and the
 * tests all import them from here today and moving callers is not this change's job.
 */

export * from "./transport.mjs"

export const PROBE_CONTAINER = "fabric-baseline-probe"
export const BASELINE_STEP_IDS = ["reach", "containers", "start", "push", "pull", "stop"]

export const STEP_TIMEOUT_MS = 60_000


/**
 * Run the six-step acceptance gate against one node.
 *
 * The file steps carry a random payload hashed on both sides rather than a fixed string, so a stale
 * copy left by an earlier run cannot be mistaken for a successful transfer -- "the file is there" and
 * "the file I just sent arrived intact" are different claims, and only the second one means the plane
 * can be trusted to deliver code.
 */
export async function runNodeBaseline(name, node, options = {}) {
  const {
    fabricRoot = defaultFabricRoot(),
    exec = defaultExec,
    stepTimeoutMs = STEP_TIMEOUT_MS,
    // The registry the caller already read, passed down so the broker resolves this node against the
    // WHOLE list rather than against the single record we happen to hold. Handing the broker a
    // one-entry registry would make its unknown-node refusal unfalsifiable -- a policy check that can
    // only ever pass is decoration. `runAllBaselines` supplies it; a lone caller may omit it and the
    // broker reads the registry itself.
    registry,
    // Injectable so a test does not append to the lab's real ledger, and so a caller that already
    // records its own actions can opt out deliberately rather than by forgetting.
    audit = (node, action, rc, detail) => auditFabricAction(fabricRoot, node, action, rc, detail),
  } = options
  const results = []
  // Transport says HOW to reach a node; os says WHAT dialect it speaks. Conflating them sent POSIX
  // commands to OMEN -- a Windows node that happens to be reached over ssh -- and the gate reported
  // `wc: not recognized` as though the cockpit were unmanageable.
  //
  // Only the dialect half is still read here. Transport is the broker's decision now, which is the
  // correct half to lose: the gate should know what language a node speaks and NOT know how to open
  // a connection to it.
  const windows = node.os === "windows"
  const payload = crypto.randomBytes(32).toString("hex")
  const digest = crypto.createHash("sha256").update(payload).digest("hex")
  const remoteFile = `/tmp/fabric-baseline-${digest.slice(0, 12)}.txt`
  const winFile = `$env:TEMP\\fabric-baseline-${digest.slice(0, 12)}.txt`
  const winPidFile = `$env:TEMP\\fabric-baseline-${digest.slice(0, 12)}.pid`
  // A node declares how it runs work. Nodes that say nothing keep the container behaviour they
  // have always had; only a node declaring "processes" -- a cockpit, deliberately not a service
  // host -- is proved through process lifecycle instead. Defaulting the other way would silently
  // change what the gate means for every existing node.
  const processes = node?.workloads === "processes"

  // Which step the broker is currently executing for, so its ledger line says `baseline.push`
  // rather than a generic `exec` and the gate's own record and the broker's can be read together.
  let currentStep = "reach"

  const step = async (id, action) => {
    currentStep = id
    const started = Date.now()
    try {
      const detail = await action()
      results.push({ node: name, step: id, ok: true, detail: detail.trim().slice(0, 160), ms: Date.now() - started })
      // Every step is recorded, including the reads. The gate starts and stops a workload on each
      // node, and until now none of that reached the ledger -- the plane's most consequential actions
      // were the only ones it did not write down. Auditing must not be able to fail the step it is
      // describing, so a ledger error is swallowed here rather than turned into a false failure.
      //
      // The swallow is survivable now in a way it was not before, and the reason is worth stating
      // because the map spent four revisions calling this line the defect. This record is no longer
      // the only one: `sh()` goes through the broker, which writes its own ledger line for every
      // command on every path and does NOT swallow the failure on success. So a start / transfer /
      // force-stop cycle can no longer complete unrecorded. What is swallowed here is the extra
      // step-level narration on top of that -- and losing narration must not fail a step that
      // actually succeeded.
      await audit(name, `baseline.${id}`, 0, detail).catch(() => {})
      return true
    } catch (error) {
      // Prefer the substantive stderr line: the first one is routinely an ssh advisory.
      const detail = (meaningfulSshError(error?.stderr) || String(error?.message || "")).slice(0, 160)
      results.push({ node: name, step: id, ok: false, detail, ms: Date.now() - started })
      await audit(name, `baseline.${id}`, error?.code ?? 1, detail).catch(() => {})
      return false
    }
  }

  // Invariant 12, in its general form: every node command in this repository goes through the
  // broker. The gate no longer decides how to reach a node -- it says which node and what to run,
  // and the broker refuses unknown names, pins host keys, picks the dialect and writes the ledger
  // line. The local and Windows-over-ssh handling that used to live here is the same code, reached
  // through `brokeredExec` instead of restated beside it.
  //
  // One deliberate consequence: a POSIX node now receives its command base64-encoded through
  // `encodePosix` rather than literally. That is the transport every other brokered caller already
  // uses, and it exists because literal POSIX bodies were being torn apart by cmd quoting before ssh
  // ever saw them. Consistency here is the point -- a gate that proves the plane can reach a node
  // should prove it over the transport the plane actually uses.
  const sh = async (command) => {
    const { stdout } = await brokeredExec(name, command, {
      fabricRoot,
      registry,
      exec,
      timeout: stepTimeoutMs,
      action: `baseline.${currentStep}`,
    })
    return stdout
  }

  if (!(await step("reach", () => sh(windows ? "$env:COMPUTERNAME" : "hostname")))) return results
  // What "running work" means depends on how the node runs it. A cockpit that is deliberately not a
  // service host still has to be inspectable; requiring a container runtime to prove that made the
  // gate test for installed software rather than for management capability.
  await step("containers", () => sh(
    processes
      ? "(Get-Process | Measure-Object).Count"
      : windows ? "(docker ps -q | Measure-Object).Count" : "docker ps -q | wc -l",
  ))
  await step("start", () => sh(
    processes
      // The pid is written next to the probe file so `stop` can end exactly what `start` began. Finding
      // the process by name later would risk killing something the gate never started.
      ? `$p = Start-Process powershell -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 60' -WindowStyle Hidden -PassThru; Set-Content -Path "${winPidFile}" -Value $p.Id; "started " + $p.Id`
      : windows
        ? `docker rm -f ${PROBE_CONTAINER} 2>$null | Out-Null; docker run -d --name ${PROBE_CONTAINER} alpine sleep 60`
        : `docker rm -f ${PROBE_CONTAINER} >/dev/null 2>&1; docker run -d --name ${PROBE_CONTAINER} alpine sleep 60`,
  ))

  // Push: written on the node, then hashed THERE. Hashing locally would only prove we can hash.
  await step("push", async () => {
    const out = windows
      ? await sh(`Set-Content -NoNewline -Path "${winFile}" -Value "${payload}"; (Get-FileHash "${winFile}" -Algorithm SHA256).Hash.ToLower()`)
      : await sh(`printf %s '${payload}' > ${remoteFile} && sha256sum ${remoteFile} | cut -d' ' -f1`)
    const seen = out.trim().split(/\s+/).pop() ?? ""
    if (seen !== digest) throw new Error(`hash mismatch on node: ${seen.slice(0, 16)} != ${digest.slice(0, 16)}`)
    return `verified ${digest.slice(0, 12)}`
  })

  // Pull: read the bytes back and hash them here. A round trip that changes the content is a plane
  // that silently corrupts what it moves, which is worse than one that cannot move anything.
  await step("pull", async () => {
    const out = windows
      ? await sh(`Get-Content -Raw "${winFile}"`)
      : await sh(`cat ${remoteFile}`)
    const back = crypto.createHash("sha256").update(out.trim()).digest("hex")
    if (back !== digest) throw new Error(`round trip altered the file: ${back.slice(0, 16)} != ${digest.slice(0, 16)}`)
    return `round trip intact`
  })

  await step("stop", () => sh(
    processes
      // Ending it is not enough: the step must prove it ended, or the plane can start work it cannot
      // stop -- which the step list calls the worst of the three failures.
      ? `$id = [int](Get-Content "${winPidFile}"); Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 300; if (Get-Process -Id $id -ErrorAction SilentlyContinue) { throw "process $id still running" }; Remove-Item "${winPidFile}","${winFile}" -ErrorAction SilentlyContinue; "cleaned"`
      : windows
        ? `docker rm -f ${PROBE_CONTAINER} | Out-Null; Remove-Item "${winFile}" -ErrorAction SilentlyContinue; "cleaned"`
        : `docker rm -f ${PROBE_CONTAINER} >/dev/null 2>&1; rm -f ${remoteFile}; echo cleaned`,
  ))

  return results
}

/**
 * Nodes are probed one at a time.
 *
 * This ran concurrently and every remote node timed out, while the identical probe against a single
 * node returned in ~340ms -- so the concurrency was the fault, not the nodes. A four-node diagnostic
 * gains nothing from parallelism worth a result nobody can trust, and a gate that reports healthy
 * machines as unreachable is worse than a slow one.
 */
export async function runAllBaselines(registry, options = {}) {
  const results = []
  for (const [name, node] of Object.entries(registry)) {
    results.push(...(await runNodeBaseline(name, node, { registry, ...options })))
  }
  return { ranAt: new Date().toISOString(), results }
}

/** A node passes only if every step passed; a partial pass is a fail with a named cause. */
export function nodePassed(results) {
  return BASELINE_STEP_IDS.every((id) => results.some((r) => r.step === id && r.ok))
}

export function summarise({ results }) {
  const byNode = new Map()
  for (const result of results) {
    const list = byNode.get(result.node) ?? []
    list.push(result)
    byNode.set(result.node, list)
  }
  const nodes = [...byNode.entries()].map(([node, list]) => ({
    node,
    passed: nodePassed(list),
    steps: list,
    firstFailure: BASELINE_STEP_IDS.map((id) => list.find((r) => r.step === id))
      .find((r) => !r || !r.ok) ?? null,
  }))
  return { nodes, passedCount: nodes.filter((n) => n.passed).length, total: nodes.length }
}
