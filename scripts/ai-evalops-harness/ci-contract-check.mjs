#!/usr/bin/env node

import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const sha256 = (value) => createHash("sha256").update(value).digest("hex")
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function listFiles(root, relative = "") {
  const directory = path.join(root, relative)
  if (!existsSync(directory)) return []
  return readdirSync(directory).sort().flatMap((name) => {
    const child = path.join(relative, name)
    return statSync(path.join(root, child)).isDirectory() ? listFiles(root, child) : [child.replaceAll("\\", "/")]
  })
}

function parsePythonRequirement(line) {
  const value = line.replace(/\s+#.*$/, "").trim()
  if (value === "" || value.startsWith("-")) return null
  const match = value.match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?\s*(==|>=|<=|~=|>|<)\s*([^=<>!~\s]+)$/)
  return match ? { name: match[1].toLowerCase().replaceAll("_", "-"), operator: match[2], version: match[3] } : { invalid: value }
}

export function classifyCiFoundation(snapshot) {
  const pnpmVersion = snapshot.packageManager?.match(/^pnpm@(.+)$/)?.[1]
  const workflow = parseWorkflowContract(snapshot.workflow)
  const violations = []
  for (const trigger of ["pull_request", "push", "workflow_dispatch"]) if (!workflow.triggers.has(trigger)) violations.push(`missing trigger ${trigger}`)
  if (!workflow.pushMain) violations.push("push trigger is not restricted to main")
  if (workflow.permissions.length !== 1 || workflow.permissions[0] !== "contents: read") violations.push("permissions must be exactly contents: read")
  const requiredJobs = ["contract", "node-quality", "focused-contracts", "python-static"]
  for (const job of requiredJobs) {
    if (!workflow.jobs.has(job)) violations.push(`missing required job ${job}`)
    if (workflow.jobConditions.has(job)) violations.push(`${job} required job must not have if condition`)
    if ((workflow.jobs.get(job) ?? []).some((step) => step.if !== undefined)) violations.push(`${job} required job must not contain conditional steps`)
  }
  const uses = (job) => (workflow.jobs.get(job) ?? []).filter((step) => step.uses).map((step) => step.uses)
  const requireOrdered = (job, commands) => {
    const steps = workflow.jobs.get(job) ?? []; let previous = -1
    for (const command of commands) {
      const index = steps.findIndex((candidate) => candidate.run === command)
      if (index < 0) violations.push(`${job} missing active command: ${command}`)
      else {
        if (steps[index].if !== undefined) violations.push(`${job} required command must not have if condition: ${command}`)
        if (index <= previous) violations.push(`${job} command out of order: ${command}`)
      }
      previous = index
    }
  }
  requireOrdered("node-quality", ["pnpm install --frozen-lockfile", "pnpm exec eslint .", "pnpm exec tsc --noEmit", "pnpm test", "pnpm build"])
  requireOrdered("focused-contracts", ["pnpm install --frozen-lockfile", "pnpm exec vitest run tests/execution-fabric-*.test.ts", "pnpm exec vitest run tests/local-runtime-status-api.test.ts tests/db-connection.test.ts tests/hermes-bridge-database-pool.test.ts", "pnpm exec vitest run tests/runtime-operator-secret-scan.test.ts tests/multi-agent-independent-secret-identity-trust-audit.test.ts"])
  requireOrdered("python-static", ["python -m compileall -q control-center/backend", "node scripts/ai-evalops-harness/ci-contract-check.mjs --assert-python-classification PARTIAL_EXACT_DIRECT_CONSTRAINTS_NO_HASH_LOCK"])
  requireOrdered("contract", ["node --test tests/ai-evalops-harness-ci-contract.test.mjs", "node scripts/ai-evalops-harness/ci-contract-check.mjs --output ai-evalops-ci-contract.json --observed-at 2026-08-11T16:00:00Z"])
  if (!snapshot.workflow.match(new RegExp(`^\\s+version: ${pnpmVersion?.replaceAll(".", "\\.") ?? "INVALID"}$`, "m"))) violations.push("workflow pnpm version does not match packageManager")
  for (const job of ["contract", "node-quality"]) if (!uses(job).includes("actions/upload-artifact@v4")) violations.push(`${job} missing active artifact upload`)
  const constraints = new Map(snapshot.pythonConstraints.map(parsePythonRequirement).filter(Boolean).filter((item) => !item.invalid && item.operator === "==").map((item) => [item.name, item.version]))
  const pythonRequirements = snapshot.pythonRequirements.map(parsePythonRequirement).filter(Boolean)
  const unconstrainedPythonRequirements = pythonRequirements.filter((item) => item.invalid || !constraints.has(item.name) || (item.operator === "==" && constraints.get(item.name) !== item.version))
  const constraintsDirectiveComplete = snapshot.pythonInputCount > 0 && snapshot.pythonConstraintDirectiveCount === snapshot.pythonInputCount
  const count = (pattern) => snapshot.testFiles.filter((file) => pattern.test(file)).length
  const gates = {
    typescript: { status: snapshot.pnpmLockPresent && violations.length === 0 ? "READY_FROZEN_INSTALL" : "BLOCKED", lockfile: "pnpm-lock.yaml" },
    python: { status: unconstrainedPythonRequirements.length === 0 && constraintsDirectiveComplete ? "PARTIAL_EXACT_DIRECT_CONSTRAINTS_NO_HASH_LOCK" : "BLOCKED_REPRODUCIBILITY", unconstrainedRequirementCount: unconstrainedPythonRequirements.length, constraintCount: constraints.size, constraintDirectiveComplete: constraintsDirectiveComplete, staticSyntaxGate: true, transitiveHashLockPresent: false },
    fabric: { status: count(/^tests\/execution-fabric-.*\.test\.ts$/) > 0 ? "READY" : "MISSING", testFileCount: count(/^tests\/execution-fabric-.*\.test\.ts$/) },
    api: { status: count(/(?:^|\/)test_api_.*\.py$|api\.test\.ts$|status-api\.test\.ts$/) === 0 ? "MISSING" : "PARTIAL_TS_GATE_PYTHON_NOT_HASH_LOCKED", testFileCount: count(/(?:^|\/)test_api_.*\.py$|api\.test\.ts$|status-api\.test\.ts$/) },
    database: { status: count(/db-connection|database-pool/) > 0 ? "PARTIAL_UNIT_ONLY_MISSING_DISPOSABLE_DB" : "MISSING", testFileCount: count(/db-connection|database-pool/) },
    component: { status: count(/\.test\.tsx$/) > 0 ? "READY" : "MISSING", testFileCount: count(/\.test\.tsx$/) },
    playwright: { status: snapshot.playwrightConfigPresent && snapshot.playwrightDependencyPresent ? "READY" : "MISSING", configPresent: snapshot.playwrightConfigPresent, dependencyPresent: snapshot.playwrightDependencyPresent },
    secret: { status: count(/secret.*\.test\.(?:ts|mjs)$/) > 0 ? "PARTIAL_PATTERN_TESTS_ONLY" : "MISSING", testFileCount: count(/secret.*\.test\.(?:ts|mjs)$/) },
    artifact: { status: uses("node-quality").includes("actions/upload-artifact@v4") && snapshot.workflow.match(/^\s+path: \.next$/m) ? "PARTIAL_BUILD_UPLOAD_NO_PROVENANCE" : "MISSING" },
  }
  return {
    schema: "williamos.ai-evalops-ci-foundation/v1",
    status: violations.length === 0 && gates.typescript.status === "READY_FROZEN_INSTALL" ? "FOUNDATION_DEFINED_WITH_EXPLICIT_GAPS" : "INVALID_FOUNDATION",
    gates,
    workflowViolations: violations,
    contractInputSha256: snapshot.contractInputSha256 ?? {},
    prohibitions: ["no dependency installation by contract checker", "no network access", "no GitHub settings mutation", "no live runtime mutation"],
  }
}

function parseWorkflowContract(text) {
  const lines = text.split(/\r?\n/)
  const triggers = new Set(); const permissions = []; const jobs = new Map(); const jobConditions = new Map(); let section; let job; let step
  let pushMain = false
  for (const raw of lines) {
    if (/^\s*#/.test(raw) || raw.trim() === "") continue
    if (/^on:$/.test(raw)) { section = "on"; continue }
    if (/^permissions:$/.test(raw)) { section = "permissions"; continue }
    if (/^jobs:$/.test(raw)) { section = "jobs"; continue }
    if (/^[A-Za-z][A-Za-z0-9_-]*:/.test(raw)) { section = undefined; continue }
    if (section === "on" && /^  (pull_request|push|workflow_dispatch):/.test(raw)) triggers.add(raw.match(/^  ([^:]+)/)[1])
    if (section === "on" && /^    branches: \[main\]$/.test(raw)) pushMain = true
    if (section === "permissions" && /^  [^#]+$/.test(raw)) permissions.push(raw.trim())
    const jobMatch = section === "jobs" && raw.match(/^  ([A-Za-z0-9_-]+):$/)
    if (jobMatch) { job = jobMatch[1]; jobs.set(job, []); step = undefined; continue }
    const jobCondition = job && raw.match(/^    if: (.+)$/)
    if (jobCondition) { jobConditions.set(job, jobCondition[1].trim()); continue }
    const stepMatch = job && raw.match(/^      - (run|uses|name): (.+)$/)
    if (stepMatch) { step = { [stepMatch[1]]: stepMatch[2].trim() }; jobs.get(job).push(step); continue }
    const property = step && raw.match(/^        (run|uses|name|if): (.+)$/)
    if (property) step[property[1]] = property[2].trim()
  }
  return { triggers, pushMain, permissions, jobs, jobConditions }
}

export function inspectRepository(root = sourceRoot) {
  const workflowPath = path.join(root, ".github/workflows/ai-evalops-harness-ci.yml")
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
  const pythonInputFiles = ["requirements.txt", "requirements-search.txt", "requirements-execution-fabric.txt"]
  const pythonInputs = pythonInputFiles.filter((file) => existsSync(path.join(root, file))).map((file) => readFileSync(path.join(root, file), "utf8").split(/\r?\n/))
  const contractInputFiles = ["package.json", "pnpm-lock.yaml", ...pythonInputFiles, "requirements-constraints.txt"]
  return {
    workflow: readFileSync(workflowPath, "utf8"),
    packageManager: packageJson.packageManager,
    pnpmLockPresent: existsSync(path.join(root, "pnpm-lock.yaml")),
    pythonRequirements: pythonInputs.flat(),
    pythonInputCount: pythonInputs.length,
    pythonConstraintDirectiveCount: pythonInputs.filter((lines) => lines.some((line) => line.trim() === "-c requirements-constraints.txt")).length,
    pythonConstraints: existsSync(path.join(root, "requirements-constraints.txt")) ? readFileSync(path.join(root, "requirements-constraints.txt"), "utf8").split(/\r?\n/) : [],
    contractInputSha256: Object.fromEntries(contractInputFiles.filter((file) => existsSync(path.join(root, file))).map((file) => [file, sha256(readFileSync(path.join(root, file), "utf8"))])),
    testFiles: [...listFiles(root, "tests"), ...listFiles(root, "control-center/backend/tests")],
    playwrightConfigPresent: ["playwright.config.ts", "playwright.config.js", "playwright.config.mjs"].some((file) => existsSync(path.join(root, file))),
    playwrightDependencyPresent: Boolean(packageJson.devDependencies?.["@playwright/test"] ?? packageJson.dependencies?.["@playwright/test"]),
  }
}

const argumentsByName = Object.fromEntries(process.argv.slice(2).flatMap((value, index, values) => value.startsWith("--") ? [[value.slice(2), values[index + 1]]] : []))
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = classifyCiFoundation(inspectRepository())
  if (argumentsByName["assert-python-classification"]) {
    if (result.gates.python.status !== argumentsByName["assert-python-classification"]) throw new Error("Python classification changed; refresh the CI contract")
  } else {
    if (!argumentsByName.output || !argumentsByName["observed-at"]) throw new Error("usage: ci-contract-check.mjs --output <path> --observed-at <ISO-8601>")
    const observedAt = new Date(argumentsByName["observed-at"])
    if (!Number.isFinite(observedAt.valueOf())) throw new Error("invalid observation timestamp")
    const evidence = { ...result, observedAt: observedAt.toISOString(), workflowSha256: sha256(inspectRepository().workflow), mutationPerformed: false }
    writeFileSync(argumentsByName.output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8")
  }
}
