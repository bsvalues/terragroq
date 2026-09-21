# WilliamOS Application Platform V1

**Status:** executable product contract  
**Date:** 2026-09-20  
**Delivery surface:** disposable WilliamOS HERMES runtime on `https://williamos.lan:3543`  
**Excluded:** every TerraFusion checkout, runtime, process, task, file, and API

## User outcome

An owner can create a new application inside WilliamOS, edit its real files, run it in a contained HERMES runtime, ask the HERMES resident AI to make a governed multi-file change, reject one proposal, apply another, and see the applied application survive a WilliamOS stop/start cycle.

The proof application is **Focus Board** (`focus-board`). It is created from the same pinned starter and uses the same routes, services, controls, proposal lifecycle, and runtime adapter as every other V1 application. No Focus Board-specific platform branch, route, component, or service is permitted.

## Application ownership and layout

Active application repositories live beneath the host-owned `WILLIAMOS_APPLICATIONS_ROOT`. On HERMES V1 this is:

`C:\HermesLab\WilliamOS-Disposable\applications`

WilliamOS source, deployment output, and application repositories are separate roots. The platform may ship a pinned starter under `starters/static-web-v1`, but the active project is a separate Git repository under the applications root. A caller can choose only a validated application ID and display name; callers cannot submit a filesystem root, command, image, mount, network mode, or Docker argument.

Creation is atomic: build a sibling temporary directory, populate the pinned starter, write the manifest, initialize a `main` Git repository with a first commit, then rename it to the validated final directory. Partial applications are removed. Existing destinations are never overwritten.

## Manifest V1

Every repository contains `.williamos/application.json`:

```json
{
  "schemaVersion": 1,
  "id": "focus-board",
  "displayName": "Focus Board",
  "adapter": "static-web-v1",
  "source": {
    "document": "src/index.html",
    "styles": "src/styles.css",
    "script": "src/app.js",
    "test": "test/application.test.mjs"
  },
  "ai": {
    "writablePaths": ["src/index.html", "src/styles.css", "src/app.js"]
  }
}
```

The host validates exact keys, schema version, ID/folder equality, UTF-8 strings, normalized relative POSIX paths, unique writable paths, supported adapter identity, required file set, regular-file identity, realpath containment, and bounded file sizes. Junctions, symlinks, absolute paths, `..`, alternate separators, NULs, and unknown keys fail closed. The host derives the validation command, container image, resource policy, runtime entrypoint, preview reader, receipt root, branch names, and all Docker arguments from trusted platform code.

The canonical manifest digest is SHA-256 over the normalized V1 projection. Proposal receipts bind `applicationId` and `manifestDigest`; apply refuses if either the manifest digest or proposal base commit has changed.

## Project catalog and workspace

Core projects remain `terrafusion` and `williamos`. Application projects are the valid direct-child repositories discovered under the applications root. Invalid entries are excluded and reported through the application catalog endpoint without making the rest of WilliamOS unusable.

For an application, the workspace root is the application repository itself. The file tree, editor, save, undo/redo, tabs, and layout operate on that real repository. The browser project key never redirects the server to a caller-provided path. Project visibility and canonical binding are resolved from the same server catalog.

## Generic API

V1 exposes one implementation for all applications:

- `GET|POST /api/applications` lists valid applications and creates from `static-web-v1`.
- `GET /api/projects/[projectKey]/application-manifest` returns the safe public projection.
- `GET|POST|DELETE /api/projects/[projectKey]/application-runtime` reads, starts, and stops the contained runtime.
- `GET /api/projects/[projectKey]/application-preview` returns the bounded self-contained HTML preview.
- `GET /api/projects/[projectKey]/application-execution-routes` returns eligible AI routes.
- `GET|POST /api/projects/[projectKey]/application-proposals` lists or creates proposals.
- `GET|PATCH /api/projects/[projectKey]/application-proposals/[proposalId]` reads or rejects/discards.
- `POST /api/projects/[projectKey]/application-proposals/[proposalId]/apply` applies.

Legacy Hello URLs may delegate to this implementation during migration, but no new application gets its own route tree.

Every mutating endpoint requires the existing owner authorization and same-origin mutation guard. Unknown, disabled, invalid, or escaped applications fail before any process, Git, Docker, or filesystem mutation.

## Contained static runtime

Application-authored server code never executes on the HERMES host or inside the container. The `static-web-v1` host adapter reads the four explicit manifest files without executing them, validates the application in the existing pinned no-network validator, and produces a bounded self-contained HTML artifact. The artifact combines the document, stylesheet, and script without evaluating application JavaScript.

The runtime creates an immutable-generation Docker container from the reviewed, digest-pinned executor image. It copies only the generated artifact and trusted WilliamOS runtime helpers into the stopped container, then starts it with:

- `--network none`
- read-only root filesystem and bounded tmpfs
- non-root UID/GID
- all capabilities dropped and `no-new-privileges`
- fixed CPU, memory, swap, PID, and log limits
- no host bind mounts or application checkout mounts
- no restart policy
- a fixed trusted entrypoint
- an explicit non-secret container environment

The Docker CLI process receives only the reviewed Windows executable environment needed to reach the intended local Docker engine. Provider keys, database URLs, auth secrets, `NODE_OPTIONS`, ambient Docker endpoints/contexts, and the platform environment do not cross the boundary. The service verifies the base image ID and refuses inherited image environment or volumes outside the adapter policy.

Because `--network none` cannot publish a preview port, the platform retrieves health and the bounded HTML through a fixed trusted `docker exec` reader selected by container ID from durable state. No shell, route, file, or command comes from the browser. The iframe remains opaque with `sandbox="allow-scripts"`; response CSP includes `connect-src 'none'`.

Runtime state is durable per application outside source/deployment roots. It records desired state, generation, source HEAD, manifest digest, artifact SHA-256, verified image ID, container ID/name, observed state, timestamps, and a bounded error code. Mutations are serialized per application with an inter-process lock. Desired state is persisted before Docker mutation. Reads reconcile deterministic names and owned labels, adopt only exact policy/artifact matches, restart a desired-running stopped container, and report unavailable/mismatch states without deleting foreign containers. Stop persists desired-stopped before stopping. Repeated start and reconciliation must not create duplicates.

## Governed AI lifecycle

The generic proposal engine preserves the existing isolated Git-worktree workflow, contained validation, review patch, owner apply, real reject/discard terminal state, quarantine behavior, execution-route provenance, and Cerebras credential bridge. It operates on the application repository root and manifest-derived paths.

For V1:

- only the three manifest writable paths may change;
- validation is the fixed adapter command `node --test test/application.test.mjs` in the pinned no-network validator;
- receipts use a new application-bound schema and storage namespace;
- worktree/branch identifiers include only validated application IDs and proposal IDs;
- two applications sharing a repository are unsupported; every V1 application is its own repository;
- apply is serialized per repository and commits only the reviewed patch;
- reject/discard is terminal and removes the isolated proposal worktree;
- provider output, patches, logs, and errors remain bounded and secret-scanned.

No provider fallback is implicit. The chosen execution route and model are shown in the proposal receipt. The delivered Focus Board proof uses the available HERMES Qwen route backed by Cerebras.

## Product UI

The Project switcher includes a clear **Create application** action. The dialog asks for name and optional slug, identifies the pinned `static-web-v1` starter, shows that the repository will be created on HERMES, and navigates to the new project after success.

Every application project renders the shared `ApplicationControls` and `ApplicationAssistant`. Labels use the manifest display name. The UI shows:

- runtime state and Start/Stop/Refresh;
- platform runtime build SHA and active application HEAD on one truth surface;
- execution route/model before submission;
- exact request, progress, changed paths, bounded patch, validation result, receipt identity;
- separate Reject/Discard and Apply actions;
- terminal `REJECTED` and `APPLIED` states;
- actionable human messages rather than raw internal error codes.

Switching projects remounts the controls so no proposal or runtime state leaks between applications. The preview iframe is present only when the contained runtime is running.

## Acceptance

On the deployed HERMES disposable runtime:

1. Create `Focus Board` from the UI and land in its real external Git repository.
2. Open and edit a real source file, save it, reload WilliamOS, and confirm the project/file state persists.
3. Start the contained runtime and use the application in the preview.
4. Ask Qwen/Cerebras for one bounded change, receive a valid proposal, reject it, and observe terminal `REJECTED` with no source change and no proposal worktree.
5. Ask for a governed multi-file change across all three writable files, review it, apply it, and observe terminal `APPLIED`, a new application commit, and the visible behavior.
6. Stop and start the platform runtime, reopen Focus Board, reconcile the same desired-running application artifact without duplicate containers, and verify the applied behavior persists.
7. The truth surface shows the deployed WilliamOS runtime-build SHA and the active Focus Board HEAD.
8. No orphan application proposal worktrees, no unaccounted quarantines, no leaked secret values, and no TerraFusion access or mutation.

The feature is not delivered until this browser journey works. Unit tests, build success, receipts, and container inspection are evidence, not substitutes.

