# WilliamOS Application Platform V1 Implementation Plan

> **Execution:** use `superpowers:subagent-driven-development`, strict test-first red/green work, per-task diff review, final whole-branch review, and browser/runtime acceptance before completion.

**Goal:** Turn the delivered Hello vertical slice into a reusable WilliamOS application-development product and prove it with a second external application, Focus Board, through create, run, AI reject, AI apply, restart, and persistence.

**Base:** exact delivered live source commit `b53498a30a88d0a8370802614e9de9174586cb5b`.

**Architecture:** a host-validated application catalog under a configured external applications root; one generic project binding and route family; a contained immutable-generation static runtime; one manifest-bound proposal engine; and shared application controls. Legacy Hello behavior remains compatible while new apps require no bespoke platform code.

**Primary spec:** `docs/superpowers/specs/2026-09-20-williamos-application-platform.md`.

## Global constraints

- Do not read, write, build, start, stop, inspect, or otherwise touch any TerraFusion checkout, process, task, runtime, file, or API.
- Active application repositories must be outside the WilliamOS source and deployment roots under host-owned `WILLIAMOS_APPLICATIONS_ROOT`.
- Browser/API callers may never supply filesystem roots, commands, images, mounts, network modes, or Docker arguments.
- Application manifests are schema version 1 with exact keys and a finite `static-web-v1` adapter. Host code derives validation and runtime policy.
- Application-authored server code must never execute on the HERMES host or in the runtime container.
- Runtime containers use the reviewed digest-pinned image, `--network none`, read-only root, non-root UID/GID, dropped capabilities, no-new-privileges, explicit resource/log ceilings, no source bind mount, and an explicit secret-free environment.
- Preview crosses the no-network boundary only through a fixed trusted bounded reader addressed by a verified owned container ID; iframe sandbox is `allow-scripts` and CSP includes `connect-src 'none'`.
- Durable desired state precedes Docker mutation; reconciliation must be idempotent and must never adopt or remove a container without exact WilliamOS ownership labels and policy/artifact identity.
- Proposals bind application ID, manifest digest, base commit, exact writable paths, execution route/model, validation result, and patch digest. Reject and Apply are distinct terminal states.
- Qwen/Cerebras credentials remain in the existing credential bridge and must not appear in source, environment projections, logs, receipts, patches, tests, or output.
- Focus Board is data created through the generic product. No Focus Board-specific route, component, branch, or service is permitted.
- Preserve the current Hello URLs and delivered behavior through delegating compatibility wrappers until migration is proven.
- Use `apply_patch` for controller-authored files. Preserve unrelated work and commits.
- A product claim requires live HERMES deployment plus direct browser acceptance, platform restart/reconciliation, exact SHA truth, and cleanup proof.

## Preflight conflict table

| Concern | Existing state | Ruling |
|---|---|---|
| Current `PRODUCT_EXECUTION.md` names TerraFusion as the W1 workload | The owner explicitly changed this disposable lane to prove non-TerraFusion application development | Keep TerraFusion completely untouched; build only the bounded WilliamOS application-platform slice on the separate Hello Lab runtime |
| Current Hello app is a subtree of WilliamOS | Safe for its original bounded proof but not a reusable product | Preserve compatibility, while all V1-created active apps are separate repositories under the external applications root |
| Current supervisor executes mutable `server.mjs` with the full environment | Incompatible with arbitrary generated applications | Replace it for generic apps with the contained static artifact runtime; do not generalize the unsafe host-child design |
| Docker `--network none` cannot expose a host HTTP port | Literal default-denied networking is required | Keep network none and broker bounded preview/health through a fixed trusted `docker exec` reader |
| Full repository tests have unrelated environment failures | Application lane baseline is independently green | Record broad-suite baseline failures; gate each task on focused tests, type/build checks, and final live browser proof |

## Task 1: External application contract, catalog, starter, and creation

**Files:**

- Create `lib/applications/application-manifest.ts`
- Create `lib/applications/application-catalog.ts`
- Create `lib/applications/application-creation.ts`
- Create `lib/applications/application-route-context.ts`
- Create `starters/static-web-v1/.williamos/application.json`
- Create `starters/static-web-v1/src/index.html`
- Create `starters/static-web-v1/src/styles.css`
- Create `starters/static-web-v1/src/app.js`
- Create `starters/static-web-v1/test/application.test.mjs`
- Create `app/api/applications/route.ts`
- Modify `lib/projects/workspace-project-key.ts`
- Modify `lib/projects/workspace-project-binding.ts`
- Modify only the project-key guards required in `app/api/environment/**`
- Create `tests/application-manifest.test.ts`
- Create `tests/application-catalog.test.ts`
- Create `tests/application-creation.test.ts`
- Create `tests/application-project-binding.test.ts`
- Extend relevant project-key/space tests

**Red tests first:**

- Invalid schema/keys/adapter/path traversal/symlink or junction/folder mismatch is refused.
- Catalog discovers two valid external apps independently and isolates one invalid sibling.
- Creation accepts `Focus Board`/`focus-board`, uses only the pinned starter, initializes `main`, commits, and atomically publishes outside the platform repository.
- Creation refuses duplicates, invalid IDs, roots under WilliamOS, caller path fields, and partial publication after a forced failure.
- Project resolution lists catalog applications and binds the selected app to its own verified repository with generic preview URL.

**Implementation:** Build exact V1 parsing/normalization and digesting; direct-child catalog discovery; injectable filesystem/Git seams; owner-guarded bounded JSON route; and dynamic application project resolution without altering TerraFusion behavior. The starter must be a useful interactive board/counter, have literal behavior assertions, and contain no product-specific platform integration.

**Verification:** focused Vitest files, `node --test starters/static-web-v1/test/application.test.mjs`, TypeScript check, clean diff, commit.

## Task 2: Durable contained per-application runtime and preview

**Files:**

- Create `lib/applications/static-web-artifact.ts`
- Create `lib/applications/application-runtime-store.ts`
- Create `lib/applications/application-runtime.ts`
- Create trusted runtime helpers under `scripts/application-runtime/`
- Create `app/api/projects/[projectKey]/application-runtime/route.ts`
- Create `app/api/projects/[projectKey]/application-preview/route.ts`
- Modify build/deployment inclusion only as required for those trusted helpers
- Create `tests/application-static-artifact.test.ts`
- Create `tests/application-runtime-store.test.ts`
- Create `tests/application-runtime.test.ts`
- Create `tests/application-runtime-routes.test.ts`
- Add/extend deployment packaging tests

**Red tests first:**

- Artifact creation reads only the four manifest files, never evaluates source, produces deterministic bounded self-contained HTML, rejects unsafe HTML/base/script escapes and source races, and records source HEAD/manifest/artifact digests.
- Docker argument arrays contain every exact isolation/resource flag and no caller-controlled token.
- Docker CLI environment excludes sentinel provider/auth/database/Docker/Node secret settings.
- Base-image mismatch, inherited disallowed environment/volumes, foreign-label collision, policy drift, timeout, oversize output, and Docker unavailability fail closed.
- Two applications have independent durable records and deterministic containers.
- Crash-point tests prove desired-state ordering, restart adoption, desired-running restart, desired-stopped retention, and no duplicate container.
- Preview/health use only the fixed reader and verified stored container ID, enforce output/time limits, and return opaque CSP/sandbox-compatible content.

**Implementation:** Reuse the reviewed validator image/policy and atomic receipt primitives, but implement a new generic runtime. Serialize with an inter-process per-app lock. Containerize a generated immutable artifact plus trusted helpers, never a source mount or app-authored server. Reconcile lazily on runtime/preview reads and explicitly during launcher readiness.

**Verification:** focused runtime/route/deployment tests, mutation check of environment/label/policy branches, TypeScript check, commit.

## Task 3: Generic manifest-bound governed AI proposals

**Files:**

- Create/refactor generic modules under `lib/applications/` for execution routing, Cerebras authoring, validation, receipt projection, and proposal lifecycle
- Create the generic dynamic proposal/execution-route API tree under `app/api/projects/[projectKey]/`
- Convert `lib/hello-application/**` and legacy Hello routes to narrow compatibility wrappers where needed
- Extend the credential-bridge adapter only if required to accept manifest-derived allowed paths; do not change vault ownership
- Create `tests/application-execution-routing.test.ts`
- Create `tests/application-proposal-validation.test.ts`
- Create `tests/application-proposal-service.test.ts`
- Create `tests/application-proposal-routes.test.ts`
- Preserve and run all Hello proposal tests

**Red tests first:**

- A proposal can modify a nonempty subset of exactly the selected app's three writable paths and cannot cross into another app or `.williamos`.
- Prompts and provider requests carry literal app identity and exact relative paths without leaking host roots or credentials.
- New receipts bind application ID, manifest digest, base commit, model/route provenance, patch digest, validation command/result, and terminal lifecycle.
- Apply refuses changed manifest/base/patch/path identity and atomically commits only the reviewed change.
- Reject creates terminal `REJECTED`, removes the proposal worktree, cannot later apply, and survives process restart.
- Repository apply serialization, stale claim recovery, quarantine, duplicate request behavior, malicious patch/output, and provider timeout remain bounded.
- Legacy Hello receipts and URLs still project correctly.

**Implementation:** Parameterize the existing proven worktree/apply transaction rather than inventing a second governance stack. Store proposals in an application namespace. The adapter fixes validation to `node --test test/application.test.mjs`; provider selection remains explicit and truthful. No implicit fallback.

**Verification:** new generic proposal tests plus every existing Hello proposal/Cerebras/execution-routing test, TypeScript check, secret scan of diff/test fixtures, commit.

## Task 4: Shared Create/Application/AI product UI

**Files:**

- Create `components/workspace-shell/create-application-dialog.tsx` and styles
- Generalize `hello-application-controls.tsx` and `hello-application-assistant.tsx` into shared application components, retaining compatibility exports only if needed
- Modify `project-switcher.tsx` and styles
- Modify `developer-preview-surface.tsx` and styles
- Modify `workspace-shell.tsx` only at project metadata/fallback/control integration seams
- Create `tests/create-application-dialog.test.tsx`
- Create `tests/application-controls.test.tsx`
- Create `tests/application-project-switcher.test.tsx`
- Extend `tests/application-neutral-developer-preview.test.tsx`
- Preserve existing Hello UI tests

**Red tests first:**

- Create Application is keyboard-accessible, explains destination/starter, submits bounded fields, renders useful conflicts/errors, and navigates to the created key.
- Any application metadata drives labels/endpoints/path summary; switching key remounts and clears runtime/proposal state.
- Start/Stop/Refresh and runtime-build SHA + active-project HEAD are present on one truth surface.
- Route/model, request, progress, changed paths, patch, validation, Reject, Apply, and terminal statuses are understandable without raw internal codes.
- Preview iframe appears only for a running contained application and keeps `sandbox="allow-scripts"`.
- A behavior test loads the real starter document and catches an unreachable or nonfunctional UI change.

**Implementation:** Drive the UI from `VisibleWorkspaceProject.kind` and the safe manifest projection. Do not branch on `hello-application` or `focus-board`. Keep code editor and app runtime usable side by side.

**Verification:** UI/application/Hello regression tests, browser-focused component behavior, accessibility queries, TypeScript check, commit.

## Task 5: Package, deploy, create Focus Board, and prove the owner journey

**Files:**

- Modify the disposable Hello Lab launcher/deployer and its tests only as needed to configure the applications root, durable application runtime root, trusted helpers, and restart reconciliation
- Create/extend a generic application Playwright specification
- Add no TerraFusion deployment or code changes

**Red acceptance automation first:**

- Browser automation must fail against the pre-change runtime because Create Application and generic APIs do not exist.
- It must detect preview behavior, not only text/source markers.

**Execution:**

1. Build from the exact feature HEAD and record the runtime build SHA.
2. Deploy only the disposable WilliamOS Hello Lab HTTP/HTTPS tasks on HERMES, preserving the existing rollback package.
3. Verify HERMES identity, Docker context/engine/Linux mode, pinned image ID, scheduled-task identity, application/runtime root ACLs, and no credential projection.
4. Create Focus Board through the browser, confirm its path is beneath `C:\HermesLab\WilliamOS-Disposable\applications` and its Git HEAD is independent of WilliamOS.
5. Start and interact with the contained preview; inspect actual container image, labels, mounts, network, user, caps, resource limits, environment, and artifact identity.
6. Submit a Qwen/Cerebras proposal and reject it; prove terminal state, unchanged HEAD, and removed worktree.
7. Submit the explicit multi-file request: `Add a Reset board button below the counter, style it as a secondary action, and implement reset behavior with accessible status text. Modify all three source files.` Review and apply it.
8. Verify new app HEAD, visible reset behavior, validation receipt, model/route/tokens/timing, and runtime build/app HEAD truth surface.
9. Stop/start the WilliamOS Hello Lab tasks, reopen Focus Board, reconcile the same desired-running artifact, verify behavior/persistence, and prove no duplicate container.
10. Prove zero orphan application proposal worktrees, zero unexpected quarantines, bounded receipts/logs, and no TerraFusion access.

**Verification:** focused full application suite, all Hello regressions, TypeScript, production build, Playwright, live browser interaction, runtime/container inspection, task restart, SHA and cleanup evidence. Commit any acceptance-test-only corrections through the normal review loop; do not patch live source by hand.

## Completion gate

The branch is complete only after every task has a clean task review, the whole-branch reviewer approves the combined diff, focused application and Hello suites pass, production build passes, and the exact deployed feature HEAD completes the live acceptance sequence. Then use `superpowers:finishing-a-development-branch` and report all ledger rulings with their cost if wrong.

