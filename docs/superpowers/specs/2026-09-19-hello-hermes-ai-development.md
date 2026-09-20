# Hello Application HERMES AI Development Spec

## Product outcome

From the Hello Application project in WilliamOS, the owner can type a novel natural-language change request and send it to the resident HERMES coding model. WilliamOS shows truthful execution milestones, the actual model and HERMES node, the resulting tested patch, and an explicit Apply action. After Apply, the preview shows the requested change and another materially different request can be made against the updated source.

This is an AI development feature. It does not claim that the inner Hello Application itself performs inference.

## Owner journey

1. Open the Hello Application project.
2. Enter a request in the visible `Ask HERMES to change this application` field.
3. Submit with `Ask HERMES`.
4. See the exact request remain visible while truthful milestones arrive: accepted, isolated workspace ready, resident started, resident finished, validation started, ready for review.
5. See the execution node, actual configured resident model, thread, turn, changed paths, fixed validation command, validation output, patch hash, and full patch.
6. Explicitly choose `Apply proposal`.
7. See the live preview refresh with the requested behavior.
8. Submit and apply a second materially different request without repairing Git or using a shell.
9. Reload and cold-restart WilliamOS; applied source, commits, and proposal receipts remain.

## Truthfulness requirements

- The browser sends the exact trimmed owner request. It does not select roots, paths, tests, commands, models, or nodes.
- The resident receives the owner request verbatim inside a server-authored scope and safety contract.
- No change-specific codemod is named or run by the generic proposal path.
- Progress reports only service-observed boundaries. It does not claim token, thought, or tool streaming.
- The configured model and node come from the reviewed resident policy. Unknown identity is shown as unknown, never inferred.
- The patch is model-authored in an isolated worktree and remains outside canonical source until Apply.
- The inner Hello Application remains accurately described as a demonstration application, not an inference client.

## Security and containment

- Existing owner authentication and same-origin mutation guards remain mandatory.
- Request text is trimmed, 1 to 2,000 characters, contains no NUL, and is persisted in the receipt with a SHA-256 digest.
- Writable scope is a nonempty subset of exactly:
  - `examples/hello-application/src/app.js`
  - `examples/hello-application/src/index.html`
  - `examples/hello-application/src/styles.css`
- Tests, package files, server code, ignored files, renames, symlinks/reparse points, binary patches, Git HEAD changes, network access, credentials, and canonical source mounts remain refused.
- HERMES uses the reviewed local-only policy, one-shot container, internal inference-proxy network, pinned model, no cloud fallback, and one concurrent run.
- One proposal transaction has a 5,400,000 ms aggregate resident deadline: at most three correction attempts, each retaining the reviewed 1,800,000 ms kernel turn budget. The proposal route allows 5,400 seconds and the HTTPS proxy allows 91 minutes so the bounded transaction can complete through the browser path.
- Before any complete source snapshot, diff check, or validator run, every validation source must be smaller than 512 KiB and the aggregate must be smaller than 1 MiB. Descriptor-bound reads reject growth, truncation, or replacement.
- Trusted validation never executes model-authored JavaScript on the HERMES host. The fixed command `node --test examples/hello-application/test/hello.test.mjs` runs in a separate no-network, read-only-root validator container using the policy-pinned resident image and a read-only workspace mount.
- The preview response carries `sandbox allow-scripts` in CSP in addition to the iframe sandbox, so direct navigation cannot grant same-origin authority to model-authored preview JavaScript.
- Apply re-derives patch paths, verifies patch hash/base/clean target, applies, validates in the isolated validator, creates a trusted exact-path commit, and then marks the receipt APPLIED. Failure rolls back or quarantines fail closed.
- A proposal becomes READY only after strict worktree cleanup and staged-artifact verification. If publication cleanup cannot be verified, an authoritative inspectable quarantine supersedes any uncertain READY state and Apply remains refused.
- TerraFusion files, tasks, processes, repositories, and runtimes are outside scope.

## API contract

`POST /api/projects/hello-application/proposals` accepts only:

```json
{"requestText":"Change the visible application in a specific way."}
```

Valid requests receive `application/x-ndjson` records:

```json
{"type":"progress","stage":"accepted","detail":"Request accepted","at":"ISO-8601"}
{"type":"progress","stage":"resident_started","detail":"HERMES is editing the isolated workspace","at":"ISO-8601","model":"williamos-qwen3-4b:64k","node":"hermes-node"}
{"type":"proposal","proposal":{"status":"READY_FOR_REVIEW"}}
```

Failures after streaming begins emit one terminal record:

```json
{"type":"error","error":"HELLO_PROPOSAL_VALIDATION_FAILED"}
```

GET listing and the existing explicit Apply endpoint remain JSON.

## Receipt additions

New receipts use schema version 2 and add:

- `requestText`
- `requestSha256`
- `executionNode`
- `progress`
- `appliedCommit` (null before Apply)

Schema version 1 receipts remain readable.

## UI direction

The assistant is an embedded project instrument above the preview, not a global chatbot or floating novelty. Preserve the existing navy technical surface, orange Ask action, green Apply action, Geist sans/mono pairing, and fine borders. Use 12–13px for request and activity text, a visible textarea label, visible focus, a polite activity log, separate alert failures, and a collapsible review body so the live preview remains usable.

## Acceptance

- Focused automated tests show a red-green cycle for request validation, generic prompts, partial allowed-path proposals, contained validation, streaming route behavior, sequential trusted commits, CSP sandboxing, and the UI request/progress/review/Apply journey.
- Production build succeeds.
- On HERMES, a novel request produces a resident-authored patch and no predetermined codemod appears in the prompt/receipt path.
- The owner reviews and applies it in the browser and sees the live result.
- A second materially different request is successfully proposed and applied.
- Reload plus cold restart preserve both applied commits and receipts.
- No one-shot containers or proposal worktrees remain; the unrelated Nous container and all TerraFusion state remain untouched.
