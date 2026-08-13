import assert from "node:assert/strict"
import test from "node:test"

import { classifyCiFoundation, inspectRepository } from "../scripts/ai-evalops-harness/ci-contract-check.mjs"

const validSnapshot = () => ({
  workflow: `on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
jobs:
  contract:
    steps:
      - run: node --test tests/ai-evalops-harness-ci-contract.test.mjs
      - run: node scripts/ai-evalops-harness/ci-contract-check.mjs --output ai-evalops-ci-contract.json --observed-at 2026-08-11T16:00:00Z
      - uses: actions/upload-artifact@v4
  node-quality:
    steps:
      - uses: pnpm/action-setup@v4
        with:
          version: 10.17.1
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec eslint .
      - run: pnpm exec tsc --noEmit
      - run: pnpm test
      - run: pnpm build
      - uses: actions/upload-artifact@v4
        with:
          path: .next
  focused-contracts:
    steps:
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec vitest run tests/execution-fabric-*.test.ts
      - run: pnpm exec vitest run tests/local-runtime-status-api.test.ts tests/db-connection.test.ts tests/hermes-bridge-database-pool.test.ts
      - run: pnpm exec vitest run tests/runtime-operator-secret-scan.test.ts tests/multi-agent-independent-secret-identity-trust-audit.test.ts
  python-static:
    steps:
      - run: python -m compileall -q control-center/backend
      - run: node scripts/ai-evalops-harness/ci-contract-check.mjs --assert-python-classification PARTIAL_EXACT_DIRECT_CONSTRAINTS_NO_HASH_LOCK
`,
  pnpmLockPresent: true,
  packageManager: "pnpm@10.17.1",
  pythonRequirements: ["-c requirements-constraints.txt", "rfc8785==0.1.4"],
  pythonConstraints: ["rfc8785==0.1.4"],
  pythonInputCount: 1,
  pythonConstraintDirectiveCount: 1,
  testFiles: [
    "tests/execution-fabric-contract.test.ts", "tests/local-status-api.test.ts",
    "tests/db-connection.test.ts", "tests/widget.test.tsx", "tests/secret-scan.test.ts",
  ],
  playwrightConfigPresent: true,
  playwrightDependencyPresent: true,
})

test("accepts a fully declared frozen foundation", () => {
  const result = classifyCiFoundation(validSnapshot())
  assert.equal(result.status, "FOUNDATION_DEFINED_WITH_EXPLICIT_GAPS")
  assert.equal(result.gates.typescript.status, "READY_FROZEN_INSTALL")
  assert.equal(result.gates.python.status, "PARTIAL_EXACT_DIRECT_CONSTRAINTS_NO_HASH_LOCK")
  assert.equal(result.gates.playwright.status, "READY")
})

test("fails the foundation when the frozen Node install is absent", () => {
  const snapshot = validSnapshot()
  snapshot.workflow = snapshot.workflow.replace("pnpm install --frozen-lockfile", "pnpm install")
  const result = classifyCiFoundation(snapshot)
  assert.equal(result.status, "INVALID_FOUNDATION")
  assert.ok(result.workflowViolations.some((item) => item.includes("node-quality missing active command")))
})

test("classifies unpinned Python requirements without installing them", () => {
  const snapshot = validSnapshot()
  snapshot.pythonRequirements = ["httpx>=0.27", "rfc8785==0.1.4"]
  const result = classifyCiFoundation(snapshot)
  assert.equal(result.gates.python.status, "BLOCKED_REPRODUCIBILITY")
  assert.equal(result.gates.python.unconstrainedRequirementCount, 1)
})

test("requires the workflow pnpm version to match packageManager", () => {
  const snapshot = validSnapshot()
  snapshot.packageManager = "pnpm@10.18.0"
  const result = classifyCiFoundation(snapshot)
  assert.equal(result.status, "INVALID_FOUNDATION")
  assert.ok(result.workflowViolations.includes("workflow pnpm version does not match packageManager"))
})

test("commented and mis-jobbed commands cannot satisfy executable gates", () => {
  const snapshot = validSnapshot()
  snapshot.workflow = snapshot.workflow.replace("      - run: pnpm exec eslint .", "      # - run: pnpm exec eslint .").replace("      - run: pnpm test", "      - run: pnpm test\n      - run: pnpm exec eslint .")
  const result = classifyCiFoundation(snapshot)
  assert.equal(result.status, "INVALID_FOUNDATION")
  assert.ok(result.workflowViolations.some((item) => item.includes("node-quality command out of order")))
})

test("write permissions or disabled triggers invalidate the workflow", () => {
  const snapshot = validSnapshot()
  snapshot.workflow = snapshot.workflow.replace("contents: read", "contents: write").replace("  workflow_dispatch:\n", "  # workflow_dispatch:\n")
  const result = classifyCiFoundation(snapshot)
  assert.equal(result.status, "INVALID_FOUNDATION")
  assert.ok(result.workflowViolations.includes("missing trigger workflow_dispatch"))
  assert.ok(result.workflowViolations.includes("permissions must be exactly contents: read"))
})

test("job-level conditions cannot disable a required gate", () => {
  const snapshot = validSnapshot()
  snapshot.workflow = snapshot.workflow.replace("  focused-contracts:\n    steps:", "  focused-contracts:\n    if: false\n    steps:")
  const result = classifyCiFoundation(snapshot)
  assert.equal(result.status, "INVALID_FOUNDATION")
  assert.ok(result.workflowViolations.includes("focused-contracts required job must not have if condition"))
})

test("step-level conditions cannot bypass a required command", () => {
  const snapshot = validSnapshot()
  snapshot.workflow = snapshot.workflow.replace("      - run: pnpm exec tsc --noEmit", "      - run: pnpm exec tsc --noEmit\n        if: false")
  const result = classifyCiFoundation(snapshot)
  assert.equal(result.status, "INVALID_FOUNDATION")
  assert.ok(result.workflowViolations.some((item) => item.includes("node-quality required command must not have if condition")))
})

test("fails when a Python input does not consume the constraints file", () => {
  const snapshot = validSnapshot()
  snapshot.pythonConstraintDirectiveCount = 0
  const result = classifyCiFoundation(snapshot)
  assert.equal(result.gates.python.status, "BLOCKED_REPRODUCIBILITY")
  assert.equal(result.gates.python.constraintDirectiveComplete, false)
})

test("classifies absent component and Playwright suites explicitly", () => {
  const snapshot = validSnapshot()
  snapshot.testFiles = snapshot.testFiles.filter((file) => !file.endsWith(".test.tsx"))
  snapshot.playwrightConfigPresent = false
  snapshot.playwrightDependencyPresent = false
  const result = classifyCiFoundation(snapshot)
  assert.equal(result.gates.component.status, "MISSING")
  assert.equal(result.gates.playwright.status, "MISSING")
})

test("classifies DB and secret gates as partial rather than overclaiming integration", () => {
  const result = classifyCiFoundation(validSnapshot())
  assert.equal(result.gates.database.status, "PARTIAL_UNIT_ONLY_MISSING_DISPOSABLE_DB")
  assert.equal(result.gates.secret.status, "PARTIAL_PATTERN_TESTS_ONLY")
})

test("the repository snapshot retains every explicit gap", () => {
  const result = classifyCiFoundation(inspectRepository())
  assert.equal(result.status, "FOUNDATION_DEFINED_WITH_EXPLICIT_GAPS")
  assert.equal(result.gates.typescript.status, "READY_FROZEN_INSTALL")
  assert.equal(result.gates.python.status, "PARTIAL_EXACT_DIRECT_CONSTRAINTS_NO_HASH_LOCK")
  assert.equal(result.gates.fabric.status, "READY")
  assert.equal(result.gates.api.status, "PARTIAL_TS_GATE_PYTHON_NOT_HASH_LOCKED")
  assert.equal(result.gates.database.status, "PARTIAL_UNIT_ONLY_MISSING_DISPOSABLE_DB")
  assert.equal(result.gates.component.status, "MISSING")
  assert.equal(result.gates.playwright.status, "MISSING")
  assert.equal(result.gates.secret.status, "PARTIAL_PATTERN_TESTS_ONLY")
  assert.equal(result.gates.artifact.status, "PARTIAL_BUILD_UPLOAD_NO_PROVENANCE")
})
