# Hello Application HERMES AI Development Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the scripted Hello proposal button into an owner-prompted, resident-model-authored, contained and repeatable AI development workflow.

**Architecture:** The existing Hello controls stream truthful NDJSON service milestones while the existing resident backend edits an isolated Git worktree. A new fixed-command validator runs model-authored code in a separate no-network container; the host only performs Git inspection, hashing, and exact-path commit operations. Existing proposal receipts, review, and explicit Apply are extended rather than replaced.

**Tech Stack:** Next.js 15 route handlers, React 19, TypeScript, Vitest/Testing Library, Node ESM, Git worktrees, Docker, HERMES resident Qwen policy.

**Spec:** `docs/superpowers/specs/2026-09-19-hello-hermes-ai-development.md`

## Global Constraints

- Never touch TerraFusion files, tasks, processes, repositories, or runtimes.
- Owner-visible browser completion outranks infrastructure breadth.
- Use strict TDD: write each behavior test, run it and observe the expected failure, then implement the minimum passing code.
- The browser supplies only bounded `requestText`; all roots, allowed paths, tests, commands, model, and node remain server-owned.
- Model writes are limited to a nonempty subset of the three existing Hello `src` files.
- Never execute model-authored JavaScript directly on the HERMES host.
- Keep existing local-only resident containment, exact patch review, explicit Apply, rollback/quarantine, and no-cloud-fallback controls.
- New UI copy must distinguish AI development from AI inside the generated application.

---

### Task 1: Preserve the Applied Hello Baseline

**Files:**
- Modify: `examples/hello-application/src/app.js`
- Modify: `examples/hello-application/src/index.html`
- Modify: `examples/hello-application/src/styles.css`
- Modify: `examples/hello-application/test/hello.test.mjs`

**Interfaces:**
- Produces: a committed clean baseline containing the already owner-applied governance marker, so deployment does not erase the live result and generic proposals begin from clean source.
- Consumes: existing `mountHelloApplication`, `nextPulseSnapshot`, and self-contained page server.

- [ ] **Step 1: Write the failing behavior test**

Extend `serves the application and health endpoint` with literal assertions that the served document contains `id="governance-marker"` and `Governed by HERMES · build ready`. Add a DOM behavior test only if the existing test environment can exercise `mountHelloApplication` without a new dependency; otherwise keep the server-visible assertion and the existing pulse-state unit test.

- [ ] **Step 2: Verify RED**

Run: `node --test examples/hello-application/test/hello.test.mjs`

Expected: failure because the local committed baseline does not yet contain `governance-marker`.

- [ ] **Step 3: Apply the exact previously reviewed marker behavior**

Add the same three-file behavior already applied on HERMES: initial marker after `#pulse-status`, optional marker lookup, zero-padded pulse update, and restrained marker styling using existing variables and no gradient.

- [ ] **Step 4: Verify GREEN**

Run: `node --test examples/hello-application/test/hello.test.mjs`

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

Commit message: `feat: preserve governed Hello baseline`

---

### Task 2: Generalize the Resident Proposal and Add Isolated Validation

**Files:**
- Create: `lib/hello-application/proposal-validation.mjs`
- Modify: `lib/hello-application/proposal-service.mjs`
- Modify: `lib/hello-application/proposal-route-context.ts`
- Modify: `tests/hello-application-proposal-service.test.ts`
- Create: `tests/hello-application-proposal-validation.test.ts`

**Interfaces:**
- Consumes: `ResidentModelExecutionBackend`, reviewed policy JSON, fixed three-file allowlist, and fixed Hello test command.
- Produces: `createHelloApplicationProposal({ repositoryRoot, runtimeRoot, requestedBy, requestText, onProgress?, residentTurn?, validateWorkspace? })` and receipts with request/model/node/progress provenance.
- Produces: `validateHelloApplicationInContainer({ repositoryRoot, runtimeRoot, workspacePath, commandRunner? })` returning `{ status: "passed", command, output }` or a typed failure.
- Produces: Apply that creates an exact-path trusted commit and returns `appliedCommit`.

- [ ] **Step 1: Write failing proposal-service tests**

Replace codemod-specific prompt assertions with literal behavioral cases:

1. `governedPrompt("Make the footer explain the AI loop")` contains that exact request, the three allowed paths, fixed test command, no Git/network rule, and does not contain `apply-governed-marker-change.mjs`.
2. Empty, over-2,000-character, and NUL requests throw `HELLO_PROPOSAL_REQUEST_INVALID` before worktree creation.
3. One-file and two-file resident changes inside the allowlist produce reviewable proposals; a no-op produces `HELLO_PROPOSAL_NO_CHANGE`; any outside/ignored/rename/HEAD mutation remains refused.
4. `onProgress` observes the exact ordered stages `accepted`, `workspace_ready`, `resident_started`, `resident_finished`, `validation_started`, `ready_for_review`.
5. Receipts persist the trimmed request, literal SHA-256, execution node, actual model/thread/turn, validation, and schema version 2 while schema version 1 receipts remain readable.
6. Apply validates in the injected validator, commits only receipt paths with parent `baseSha`, leaves canonical source clean, returns `appliedCommit`, and permits a second proposal from the new HEAD.
7. Validation or commit failure rolls back exact paths and never marks APPLIED.

- [ ] **Step 2: Verify proposal tests RED**

Run: `npx vitest run tests/hello-application-proposal-service.test.ts`

Expected: failures because request-driven prompts, partial path sets, progress, schema v2, isolated validation injection, and trusted Apply commits do not exist.

- [ ] **Step 3: Write failing validator tests**

Use an injected command runner and literal expected Docker arguments to prove:

- policy-pinned image and Docker config are used;
- `--network none`, `--read-only`, `--cap-drop ALL`, `--security-opt no-new-privileges:true`, bounded CPU/memory/PIDs, `--user 10000:10000`, read-only `/workspace` mount, `/tmp` tmpfs, and `--entrypoint node` are present;
- the only command is `--test examples/hello-application/test/hello.test.mjs`;
- workspace must be a direct child of `<runtimeRoot>/worktrees`, all allowed sources/tests are regular non-link files, and image ID must equal policy `build.imageId`;
- command failure is sanitized to `HELLO_PROPOSAL_VALIDATION_FAILED`.

- [ ] **Step 4: Verify validator tests RED**

Run: `npx vitest run tests/hello-application-proposal-validation.test.ts`

Expected: module-not-found failure for the new validator.

- [ ] **Step 5: Implement the isolated validator**

Create a narrow adapter that reads the reviewed policy from `repositoryRoot`, verifies the workspace and file types without following links, verifies `docker image inspect` returns the pinned image ID, and runs only the fixed test command with the exact walls asserted above. Capture at most the trailing 12,000 characters of output.

- [ ] **Step 6: Implement request-driven proposals**

Remove the marker expected-source import and semantic equality check from the generic path. Normalize the request, allow any nonempty subset of the existing three files, emit observed milestones, pass the owner request to the resident prompt, use the injected/default isolated validator, persist schema v2 provenance, retain all Git/hash/scope walls, and preserve v1 receipt reads.

- [ ] **Step 7: Implement trusted sequential Apply**

After isolated post-apply validation, stage exactly `changedPaths`, commit with fixed identity `WilliamOS HERMES Apply <hermes@williamos.local>` and message `apply(hello): governed proposal <proposalId>`, verify the commit parent and committed paths, persist `appliedCommit`, and leave the canonical source clean. On any validation or commit failure, unstage/reverse exact paths, verify cleanliness, or mark `QUARANTINED_ROLLBACK_FAILED`.

- [ ] **Step 8: Verify GREEN**

Run:

`npx vitest run tests/hello-application-proposal-validation.test.ts tests/hello-application-proposal-service.test.ts`

Expected: all tests pass.

- [ ] **Step 9: Commit**

Commit message: `feat: accept governed HERMES development requests`

---

### Task 3: Stream Truthful Proposal Milestones and Harden Preview

**Files:**
- Modify: `app/api/projects/hello-application/proposals/route.ts`
- Modify: `app/api/projects/hello-application/preview/route.ts`
- Modify: `tests/hello-application-proposal-routes.test.ts`
- Modify: `tests/hello-application-runtime-routes.test.ts`

**Interfaces:**
- Consumes: Task 2 request-driven service and progress callback.
- Produces: bounded request parser and `application/x-ndjson` progress/proposal/error stream.
- Produces: preview CSP containing `sandbox allow-scripts`.

- [ ] **Step 1: Write failing route tests**

Assert that a valid same-origin POST body `{ requestText: "Change the footer" }` forwards only that string plus server roots/owner, returns NDJSON, emits ordered progress records followed by one proposal record, and leaves Apply separate. Assert malformed JSON, unknown keys, empty/NUL/over-limit text return 400 before the resident service. Assert service failure becomes one terminal sanitized error record. Extend preview assertion to require `sandbox allow-scripts`.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/hello-application-proposal-routes.test.ts tests/hello-application-runtime-routes.test.ts`

Expected: failures because POST ignores the body, returns JSON only after completion, and preview CSP lacks sandbox.

- [ ] **Step 3: Implement the streaming route**

Parse and validate the exact one-key JSON object before constructing a `ReadableStream`. Encode one JSON object per newline. Run proposal creation without blocking response construction; map the service callback to progress records, emit exactly one final proposal or error, close in all cases, and do not surface stack traces or command stderr. Preserve no-store, owner, origin, server-root, and 1,800-second route boundaries.

- [ ] **Step 4: Add defense-in-depth preview sandbox**

Append `sandbox allow-scripts` to the preview response CSP while retaining `default-src 'none'`, `connect-src 'none'`, `form-action 'none'`, and `base-uri 'none'`.

- [ ] **Step 5: Verify GREEN**

Run: `npx vitest run tests/hello-application-proposal-routes.test.ts tests/hello-application-runtime-routes.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit**

Commit message: `feat: stream HERMES proposal progress`

---

### Task 4: Build the Owner-Facing Ask HERMES Experience

**Files:**
- Modify: `components/workspace-shell/hello-application-controls.tsx`
- Modify: `components/workspace-shell/hello-application-controls.module.css`
- Create: `components/workspace-shell/hello-application-assistant.tsx`
- Create: `components/workspace-shell/hello-application-assistant.module.css`
- Modify: `tests/hello-application-controls.test.tsx`

**Interfaces:**
- Consumes: Task 3 NDJSON stream, existing proposal listing, runtime route, and explicit Apply route.
- Produces: `HelloApplicationAssistant` with an accessible request form, exact request echo, truthful milestone log, execution identity, validation output, patch review, Apply, and preview refresh; runtime controls remain focused on process lifecycle.

- [ ] **Step 1: Write the failing UI test**

Drive the real component with a complete fetch double. Type `Make the footer explain the local AI loop`, submit `Ask HERMES`, and assert:

- POST body is exactly `{"requestText":"Make the footer explain the local AI loop"}`;
- the exact owner request remains visible;
- NDJSON milestones render in a polite activity log without fabricated percentages;
- final HERMES node/model/thread/turn, changed paths, test status/output, patch hash, and patch render;
- Apply is absent before READY_FOR_REVIEW and present afterward;
- Apply refreshes preview and the form remains available for a second distinct request;
- failed streams preserve draft/request and show an alert; empty request stays client-side; busy state prevents duplicate submission.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/hello-application-controls.test.tsx`

Expected: failures because no request form or NDJSON reader exists.

- [ ] **Step 3: Implement the UI**

Extract the fixed governance/proposal area into `HelloApplicationAssistant` and keep `HelloApplicationControls` responsible for runtime lifecycle plus composition. Build a compact embedded Ask panel with a visible textarea label `Ask HERMES to change this application`, button `Ask HERMES`, exact request transcript, `role="log"` for milestones, `role="status"` for the latest concise state, `role="alert"` for errors, and keyboard-scrollable patch/test output. Keep runtime actions independent, make the review body collapsible, and label the boundary `3 writable UI files · local model · proposal only`.

- [ ] **Step 4: Apply the visual system**

Keep the current navy/steel shell, orange Ask, green Apply, fine borders, and Geist pairing. Raise conversational text to 12–13px, preserve preview height with bounded panel scrolling, add visible `:focus-visible`, support narrow widths with wrapping, and honor reduced motion by adding no nonessential animation.

- [ ] **Step 5: Verify GREEN**

Run: `npx vitest run tests/hello-application-controls.test.tsx`

Expected: all tests pass.

- [ ] **Step 6: Commit**

Commit message: `feat: add Ask HERMES development workflow`

---

### Task 5: Integrated Verification, HERMES Deployment, and Browser Acceptance

**Files:**
- Modify only if failures require a focused test-first correction in files from Tasks 1–4.
- Produce runtime evidence under the existing HERMES disposable root; do not write TerraFusion.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: owner-visible acceptance and retained restart evidence.

- [ ] **Step 1: Run focused and full verification**

Run the focused Hello suites, `git diff --check`, and the production build. Then run the repository test suite appropriate to the changed surfaces. Record exact pass/fail counts and build warnings.

- [ ] **Step 2: Independent whole-branch review**

Review security boundaries, route streaming, receipt compatibility, sequential commits, UI truthfulness, accessibility, and absence of TerraFusion changes. Resolve every Critical/Important finding through the prescribed fix loop.

- [ ] **Step 3: Package and deploy transactionally**

Build a standalone artifact from the clean committed branch, verify provenance, stage source/runtime on HERMES, preserve external state and prior receipts, stop/start only `WilliamOS Hello Lab` and `WilliamOS Hello Lab HTTPS`, and prove HTTP/HTTPS health report the new exact SHA. Do not touch `WilliamOS Live`, `WilliamOS HTTPS`, the unrelated Nous container, or any TerraFusion task/process/path.

- [ ] **Step 4: Browser acceptance request one**

In the owner UI, enter a new request that was not encoded in tests or implementation. Observe actual milestones and HERMES identity, inspect the model-authored patch and validation, Apply, refresh, and verify the requested visible result.

- [ ] **Step 5: Browser acceptance request two**

Enter a materially different request against the newly committed source. Verify a new base SHA, model-authored patch, tests, explicit Apply, a second trusted commit, and the second visible result.

- [ ] **Step 6: Cold restart and containment audit**

Stop the inner app, restart only the two disposable Hello scheduled tasks, reload, restart the inner app, and prove both applied results and receipts persist. Confirm exact source HEAD/clean status, 200 HTTP/HTTPS health, zero one-shot containers/worktrees/quarantine, isolated network membership, unchanged unrelated Nous container, and no TerraFusion interaction.

- [ ] **Step 7: Visual critique and deliverable mark**

Capture the final request/progress/review/preview state. Verify the request path is understandable without explanation, model identity and proposal boundary are legible, controls remain reachable, errors are actionable, and the preview is still useful. Mark the browser tab as the deliverable.
