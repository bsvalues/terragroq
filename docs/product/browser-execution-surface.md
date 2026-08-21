# The browser is an execution surface, not the operating system

A requirement of the Workbench architecture (owner, 2026-08-21), written after studying Polar — an
agentic Chromium browser. It is a requirement, not a future spike: the browser surface is part of
what the environment IS, sequenced so it does not derail the work already in flight.

## The inversion

Polar's ambition is to make the **browser** the work operating system: an agent that inhabits a
Chromium fork and does your work by driving pages the way a person would. WilliamOS is the opposite,
and for what we are building, the stronger shape:

> **WilliamOS is the Work OS. The browser is one of its execution surfaces.**

Polar's agent *must* impersonate a human clicking through Gmail, CRMs, spreadsheets, and websites,
because the browser is all it has. WilliamOS chooses the best controlled interface for each step:

```
API call · GitHub operation · SSH/node operation · database query · MCP/tool · browser automation · human
```

The distinction is about **actuating** work, not observing it. To *drive* work — change state, submit
a form, click through a flow — browser automation is the **fallback**: the plane used when an
application exposes no better governed interface (no API, no operation, no query). But to *observe and
validate* — prove the real UI a user sees is consistent with the API behind it — driving the actual
browser is first-class even when an API exists; end-to-end UI validation is a legitimate use, not a
last resort (the parcel-search UI/API-consistency check below is exactly that). What we avoid is
*betting the product* on impersonating a human to get work done — which is why a full Chromium fork is
the wrong investment, not why we avoid the browser.

## Every browser operation carries a work identity

The surface is not "an embedded browser." It is a **governed execution surface**: every operation
runs under a WilliamOS work identity and produces evidence, exactly like every other plane.

```
Thread
  └── Objective
       └── Work Order
            └── Browser Session
                 ├── page context
                 ├── observations
                 ├── proposed actions
                 ├── authority          (a canonical A0–A9 level — permitted / refused)
                 ├── actual actions
                 ├── evidence           (screenshot · DOM snapshot · network receipt · trace — secrets redacted)
                 └── resulting state     (UI/API consistency)
```

Authority is the **existing** ladder, not a bespoke browser token: observing (navigate / read /
screenshot) is `A0_READ_ONLY`; acting (click / type / submit) demands at least `A2_WRITE_OWN`,
escalating by what the action touches — `A6_AUTH` for a sign-in or anything touching sessions/secrets,
`A5_DESTRUCTIVE` for a delete. These are the `AUTHORITY_LEVELS` in `lib/goal/taxonomy.ts`, validated by
the same grant engine as every other plane; the adapter demands a canonical level and is refused if
the grant does not cover it. Evidence is **redacted before it persists**: screenshots, DOM snapshots,
and network receipts of an authenticated session would otherwise capture passwords, cookies, and
auth/CSRF tokens, so credential fields, `Set-Cookie`/`Authorization` headers, and known secret shapes
are masked at capture time — never written raw.

What another agent presents as a throwaway line — *"Agent clicked button."* — becomes a record:

```
WO-01982
Agent: codex-worker-17
Objective: Validate TerraFusion parcel search
Observed:  /property/search loaded
Proposed:  Search parcel 1-2345
Authority: A0 · Read-only — permitted
Action:    entered parcel ID, submitted query
Result:    1 matching property · API 200 · UI/API state consistent
Evidence:  screenshot · DOM snapshot · network receipt · execution trace
STATUS:    PASS
```

That record — not the click — is the deliverable. It is the difference between an agent that *tells
you* there is work to do and an agent with a governed surface through which it *does* the work and
proves it.

## What we take from Polar, and what we do not

Take the **interaction model**, not the browser:

1. Agent and human inhabit the same workspace — you see what it sees and can intervene.
2. Persistent authenticated browser state — agents do not restart from a sterile browser each time.
3. Long-running work — a task is not assumed to fit in one model turn.
4. Saved workflows — a successful run becomes reusable capability.
5. Browser context is native agent context.
6. Human takeover as an *exceptional intervention* — the owner can step in without destroying the run,
   but the routine mode is the owner **observing**, not operating. Taking over is the exception the
   simulations reserve (`environment-simulations.md`), never a role that makes William the routine
   browser operator.
7. One small primitive: tell it the outcome you want.

Do **not** take: the Chromium fork, the cloud agent backend, the third-party telemetry. On top of the
interaction model WilliamOS adds the spine Polar does not own:

```
authority → placement → dispatch → execution → independent review → remediation → evidence → persistence → recovery
```

## The Polar lesson we do not get to dismiss

Polar began as an Electron shell (Composer) and abandoned it for a real Chromium fork because a shell
struggled with authenticated sessions, complex UIs, extensions, and maintaining a live understanding
of the user's work. A bare shell is **not** equivalent once browser automation *is* the product.

WilliamOS mitigates this differently — the browser is a fallback surface, not the product, so the
engine ceiling matters far less — and it keeps an escalation path if a concrete need ever forces the
engine level: **WebView2 → CEF → Chromium fork**, taken only when a real requirement forces it, never
preemptively.

## First version

Not a separate product called "WilliamOS Browser," and not a six-week project. It extends the
**replacement Environment (the Desk)** — never the legacy Workbench, which `environment-refusals.md`
makes a compatibility application the replacement must not import, render, wrap, or embed:

```
the Desk / replacement Environment
  + embedded WebView2            (Chromium via the Edge runtime already on Windows — no bundled/forked Chromium)
  + a controlled browser session (persistent, authenticated, owned by the Work Order)
  + an observation/action adapter (CDP/Playwright: observe → propose → act, gated by A0–A9 authority)
  + Evidence/Authority integration (the record above, secrets redacted, on every action)
```

The *governance* pieces already exist — authority (`lib/goal/taxonomy.ts`), evidence/receipts, the
work-context gate. The *browser engine* does **not**: there is no in-repo CDP/Playwright automation
today, and the Desk's current browser surface is a deliberately inert sandboxed iframe backed by a
cookieless, script-stripping proxy that *cannot* drive a page. So the WebView2/CDP adapter and the
persistent authenticated session are genuine new prerequisites, not existing capability. The work is
joining the new adapter to the existing governance spine into one coherent operator experience — the
concrete, human-facing execution environment for the standing test: *"finish the TerraFusion
permitting suite and prove it,"* answered by work done and evidenced, not by a list of what the owner
should do next.

## Polar itself stays outside the boundary

Polar is a legitimately signed product (Recursive Intelligence; installer and binaries chain-valid
and timestamped, no autostart persistence) — which proves provenance and integrity, not safety. Its
own privacy policy states that agent requests can send prompts, screenshots, page context, files,
conversation history, and tool output to its backend and model providers. It therefore sits **outside
the sovereign/trusted boundary** and is admitted, if ever, only by a deliberate provider-doctrine
decision — never by default. We study its interaction model; we do not run our work through it.

## First slice: the pieces to join (verified against the codebase)

The *governance* pieces exist; the *engine* does not. Checked against the tree, the browser surface is
a **sibling of `app/api/loom/run`**, reusing the governance spine and adding a real automation engine:

| Concern | Existing piece to reuse | New work |
|---|---|---|
| Bounded, evidenced execution | `app/api/loom/run` — authenticated, work-context-gated, streams a real process, records receipts. *"Safety comes from the catalogue, not from parsing."* | A sibling route in the same mold |
| Authority | `requireWorkContext` / `workContextRefusal` gate + the `AUTHORITY_LEVELS` ladder (`lib/goal/taxonomy.ts`) | Map ops to canonical levels — observe → `A0_READ_ONLY`, act → `A2_WRITE_OWN`+ (escalating to `A6_AUTH`/`A5_DESTRUCTIVE` by what the action touches), the act requiring an explicit `confirmed` step like `loom/run`'s state-changing ops |
| Evidence | `lib/loom/receipts` (`recordLoomStart`/`recordLoomEnd`), `lib/governance/artifacts` | Emit screenshot · DOM · network · trace artifacts on every act, **with secrets redacted at capture** |
| Session as work identity | `lib/environment/working-world` persistence pattern | A `BrowserSession` row tied to a Work Order, holding page context + observe/propose/act log |
| Rendering surface | The Desk frames pages today via the `view` proxy (`app/api/environment/view`) — but a **deliberately inert, script-stripped, cookieless sandbox iframe that cannot drive a page** | A driveable surface + observe/act overlay — genuinely new, not the current iframe |
| Engine | — nothing in-repo (the CDP driving used for evidence to date is external MCP, not application code) | A Node adapter driving **WebView2 via CDP** on the runtime host — a genuine prerequisite, in the "real process on this machine" pattern `loom/run` establishes |

Two genuinely new contracts, everything else composed:

```ts
// The catalogue — safety is the enumeration, not parsed operator text (loom/run's rule).
type BrowserOp =
  | { kind: "navigate"; url: string }                    // observe
  | { kind: "readPage" }                                 // observe
  | { kind: "screenshot" }                               // observe
  | { kind: "clickRef"; ref: string }                    // act  — requires confirmed + act scope
  | { kind: "typeInto"; ref: string; text: string }      // act  — requires confirmed + act scope
  | { kind: "submit"; ref: string }                      // act  — requires confirmed + act scope

// The record — the deliverable is this, not the click.
type BrowserAction = {
  workOrderId: string
  observed: string            // what the page showed
  proposed: BrowserOp         // what the agent intends
  demandedAuthority: AuthorityId  // a canonical A0–A9 level (lib/goal/taxonomy.ts), validated by the grant engine
  permitted: boolean
  actual?: BrowserOp          // what actually ran
  evidence: RedactedEvidence  // screenshot/dom/network/trace with secrets masked at capture
  result: string              // UI/API state consistency
  status: "PASS" | "FAIL" | "REFUSED"
}
```

The build is therefore: **one bounded route + a catalogue + a session record + a redacting evidence
writer + a WebView2/CDP adapter**, mapping ops onto the canonical A0–A9 ladder — reusing the gate,
receipts, artifacts, and persistence that already ship, and adding the driveable surface the current
inert iframe is not. That is why this is a requirement of the architecture being finished, not a
separate product: it is the join, not a rebuild. Sequenced after the current environment deploy
unblocks; it does not touch the critical path.
