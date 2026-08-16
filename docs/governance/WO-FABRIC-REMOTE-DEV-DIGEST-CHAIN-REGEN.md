# WO-FABRIC-REMOTE-DEV-DIGEST-CHAIN-REGEN — regenerate the AEGIS remote-dev digest chain against deployed truth

**Status:** CLOSED 2026-08-16 — resolved as **Historical** (owner decision). No pin was changed;
the manifest, receipt, and installed AEGIS state are untouched. The root-handoff test now anchors
its assertions to the manifest's own generation. Read §0 first; §1–§7 below are the original
investigation and remain accurate as history.

## 0. Outcome and why (read this)

**Deployed truth (owner, verified read-only from AEGIS via HERMES):** entrypoint on disk is
`2c6c5ccd`; installed bundle manifest is `fe82ce6b` (= repo); receipt
`/var/lib/williamos-fabric/remote-dev-prerequisite-verified.json` present (transaction
`6ad8e3e2`, authority `5368f65d`, `trustedMainCommit 98b458b9`).

**Case A ("regenerate the chain") was executed on the branch and then withdrawn** after two
facts surfaced that the original plan did not know:

1. `aegis-remote-dev-prerequisites.json` is the *superseded v1 preflight*; its JCS digest
   `8b956f9e` is provenance pinned in the v2 manifest, `root-handoff.mjs`, `prerequisites.mjs`
   and the owner-authority binding. Editing it regressed
   `execution-fabric-aegis-remote-dev-prerequisites.test.ts` 0→9. Never edit it.
2. The success receipt is **single-shot by design**: `publishReceipt`
   (`aegis-remote-dev-root-os-adapter.mjs:717-738`) opens it `O_CREAT|O_EXCL` and rejects any
   receipt from another transaction/journal head (`SUCCESS_RECEIPT_CONFLICT`). A re-run handoff
   would verify, commit, and fail at publish. Making a regenerated manifest live would therefore
   require root-deleting a settled record (also pinned by the installed
   `aegis-success-receipt-mode-settlement`), updating the hardcoded `98b458b9` pins
   (`remote-dev-offload-activation.mjs:400`, settlement), and two merges to `main`.

Conclusion: the manifest's `018406b0` is **true history** (what the Aug‑12 handoff installed);
the entrypoint moved to `2c6c5ccd` afterwards through the sanctioned activation‑bridge path
(`EXACT_PREDECESSOR dfcc26c8 → 2c6c5ccd`). AEGIS is already in the correct state. The only
defect was the test's anchor.

**Fix applied (test-only; no production module or config touched):**
`tests/execution-fabric-aegis-remote-dev-root-handoff.test.ts` "pins the merged prerequisite
generation and every applied asset exactly" now resolves the manifest's *generation* = the oldest
commit carrying HEAD's exact manifest bytes (revert-proof), asserts every applied asset and every
trusted-evidence path at that generation (`0543347`, "settle exact receipt mode predecessor" — all
26 + 7 match), runs `inspectRootHandoffBundle` against a temp export of that generation (drift
`[]`), and additionally asserts that on the *live* tree the inspector still reports
`BUNDLE_BINDING_DRIFT` honestly for bridge‑advanced assets (not blinded). `git show HEAD:` was
the wrong proxy: it assumed HEAD == the reviewed generation.

Not done, by decision: no AEGIS mutation, no re-handoff, no receipt/settlement change, no
regeneration. If a future reviewed change *must* move the manifest, it is a full ceremony
(merge → stage bundle as root → mint owner authority on OMEN [key:
`~/.williamos/authorities/WO-TF-REMOTE-DEV-OFFLOAD-001/`, verified to match the installed public
key] within 15 min → `--apply` → root-rotate the settled receipt → re-settle → update `98b458b9`
pins → merge) and gets its own WO.

**Original blocking status (superseded):** DRAFT — blocked on one owner input (§4).

**Why this is a WO and not an edit:** two remedies were tried from OMEN on 2026-08-16 and both
measured worse; both were reverted. The chain is multi-level (config → manifest → production
constant → tests) and the correct target depends on a fact only the AEGIS host can supply.

## 1. Measured drift (2026-08-16, branch `wo/resident-executor-s1` @ `55a2b4f`)

Every asset digest pinned in production `EXPECTED_ASSET_DIGESTS`
(`scripts/execution-fabric/provision/aegis-remote-dev-root-handoff.mjs:38-…`) was recomputed
against the working tree with sha256: **26 pinned, 25 match, 1 drifted.**

| Asset | Pinned | Live |
|---|---|---|
| `scripts/execution-fabric/provision/aegis-remote-dev-ssh-entrypoint.mjs` | `018406b0…` | `2c6c5ccd…` |

Generations of the entrypoint (sha256 of the file at each commit that touched it):

| Commit | Date | Entrypoint sha256 (prefix) | Origin |
|---|---|---|---|
| `ba9e9c2` | 2026-08-11 | `931f43de` | package AEGIS prerequisites |
| `04920bb` | 2026-08-11 | **`018406b0`** | bind prerequisite trust ← **still pinned in production** |
| `af902ca` | 2026-08-12 | `1eba3632` | bounded AEGIS activation bridge |
| `0fcbfc1` | 2026-08-12 | `dfcc26c8` | #725 bound activation relay startup |
| `77b1430` | 2026-08-12 | **`2c6c5ccd`** | #736 recover exact activation preclaim ← **live source** |

No manifest regeneration accompanied `af902ca`, `0fcbfc1`, or `77b1430`. There is no CI in the
repo, so nothing flagged it.

## 2. Every occurrence of the stale pin (`018406b0`) — the chain

| # | Level | Location | Note |
|---|---|---|---|
| 1 | Config | `config/execution-fabric/aegis-remote-dev-prerequisites.json:203` (`bindings[]`) | Changing this changes the file's own digest `f56cb79c…`, which is itself pinned at #3 and #4 |
| 2 | Manifest | `config/execution-fabric/aegis-remote-dev-root-handoff.json:215` | Bundle manifest installed to `/usr/local/share/williamos/aegis-root-handoff-bundle/…` on AEGIS |
| 3 | Production constant | `scripts/execution-fabric/provision/aegis-remote-dev-root-handoff.mjs:43` (`EXPECTED_ASSET_DIGESTS`) | Also pins prerequisites.json at `:40` = `f56cb79c` (see #1) |
| 4 | Manifest (self-digest) | `config/execution-fabric/aegis-remote-dev-root-handoff.json:191` | `f56cb79c` for prerequisites.json — moves if #1 moves |
| 5 | Test | `tests/execution-fabric-aegis-activation-bridge-bootstrap.test.ts:27` | Asserts `018406b0` classifies as `DRIFT` (i.e. *not* an upgradeable predecessor) |

Occurrences of the live sha (`2c6c5ccd`) already present:
`config/execution-fabric/remote-dev-offload-v1-activation.json:124` (forward bundle,
`historicalSuccessClaimed: false`) and the bridge-bootstrap test (`:23`, as `current`).

## 3. The contradiction the WO must resolve

Two production surfaces disagree about what AEGIS holds:

- **Root handoff** (`aegis-remote-dev-root-handoff.mjs`) says the installed entrypoint should be
  `018406b0` (generation `04920bb`).
- **Activation bridge** (`inspectBridgeDestinationState`, proven by the bootstrap test) will only
  upgrade an installed `dfcc26c8` (generation `0fcbfc1`/#725) to `2c6c5ccd`; it classifies
  `018406b0` and `1eba3632` as `DRIFT` and refuses.

If AEGIS actually holds `018406b0`, the bridge cannot upgrade it and the root handoff is
correct-but-stale. If AEGIS holds `dfcc26c8` or `2c6c5ccd`, the root handoff's drift inspector
is reporting drift on a healthy host.

Why the two quick fixes failed (do not retry):
- **Freeze test to `018406b0` everywhere:** blinds the production drift inspector against the
  forward bundle; measured worse.
- **Update only the production constant to `2c6c5ccd`:** breaks levels #1/#2/#4 (prerequisites.json
  and manifest still say `018406b0`, and prerequisites.json's own digest is pinned) → suite went 1→4
  failures; reverted.

## 4. Owner input required (blocking)

On AEGIS, run and paste the results here:

```bash
sha256sum /usr/local/libexec/williamos-aegis-remote-dev-ssh-entrypoint.mjs
grep -n '"sha256"' /usr/local/share/williamos/aegis-root-handoff-bundle/config/execution-fabric/aegis-remote-dev-root-handoff.json | head -40
```

Answer: **which generation does AEGIS hold — `018406b0` (04920bb), `dfcc26c8` (#725), or
`2c6c5ccd` (#736)?** Also state whether the installed bundle manifest matches this repo's
`aegis-remote-dev-root-handoff.json` (i.e. was the root handoff ever re-run after 2026-08-11).

## 5. Execution plan (after §4 is answered)

Case A — AEGIS holds `2c6c5ccd` (or `dfcc26c8` and the bridge is meant to bring it forward):
1. Regenerate, in this order, using the existing generator (locate:
   `grep -rn "EXPECTED_ASSET_DIGESTS\|bindings" scripts/execution-fabric/provision/*.mjs`):
   a. `aegis-remote-dev-prerequisites.json` `bindings[]` entrypoint → `2c6c5ccd`
   b. recompute prerequisites.json digest → replace `f56cb79c` at manifest `:191` and constant `:40`
   c. manifest `:215` and constant `:43` → `2c6c5ccd`
2. Bootstrap test `:27`: `018406b0` stays `DRIFT` (correct — it is not the reviewed predecessor).
   No change.
3. Verify: `node` recompute of all 26 pins = 26/26 match; targeted suites green:
   `pnpm exec vitest run tests/execution-fabric-aegis-activation-bridge-bootstrap.test.ts tests/execution-fabric-remote-dev*.test.ts tests/execution-fabric-aegis*.test.ts`
4. Record the AEGIS evidence from §4 in this file under "Deployed truth".

Case B — AEGIS holds `018406b0` and has never been re-provisioned:
1. Do **not** regenerate manifests first. The bridge cannot upgrade from `018406b0`; the correct
   path is a root-handoff re-run on AEGIS with the current bundle (owner-executed, gated), *then*
   Case A.
2. Alternatively, extend `inspectBridgeDestinationState` to accept `018406b0` as an
   `EXACT_PREDECESSOR` — only if the owner reviews that the `018406b0 → 2c6c5ccd` delta is safe to
   apply without the intermediate #725 relay-startup fix. Default: **do not** widen the predecessor
   set.

## 6. Acceptance

- 26/26 `EXPECTED_ASSET_DIGESTS` match live tree (second-method: `sha256sum` + node `crypto`).
- Bootstrap test still classifies `018406b0` and `1eba3632` as `DRIFT`.
- No `historicalSuccessClaimed` flag flipped without AEGIS evidence attached to this WO.
- CI (once bootstrapped — see `.github/workflows/ci.yml`) is green on the regenerated state.

## 7. Diagnostics

`pins.mjs` (recompute all pins vs. tree) is trivially rebuildable: read
`EXPECTED_ASSET_DIGESTS` block from the root-handoff module, sha256 each path, print
OK/DRIFT. Generation table in §1 = `git show <commit>:<path> | sha256sum` per commit in
`git log -- scripts/execution-fabric/provision/aegis-remote-dev-ssh-entrypoint.mjs`.
