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

Browser automation is the **fallback** — the plane we use when an application exposes no better
governed interface. Clicking a page is never the first choice; it is the choice of last resort when
there is no API, no operation, no query. This is why a full Chromium fork is the wrong investment: we
are not betting the product on impersonating a human in a browser.

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
                 ├── authority          (e.g. READ_ONLY_BROWSER — permitted / refused)
                 ├── actual actions
                 ├── evidence           (screenshot · DOM snapshot · network receipt · execution trace)
                 └── resulting state     (UI/API consistency)
```

What another agent presents as a throwaway line — *"Agent clicked button."* — becomes a record:

```
WO-01982
Agent: codex-worker-17
Objective: Validate TerraFusion parcel search
Observed:  /property/search loaded
Proposed:  Search parcel 1-2345
Authority: READ_ONLY_BROWSER — permitted
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
6. Human takeover without destroying the run.
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

Not a separate product called "WilliamOS Browser," and not a six-week project. Evolve the canonical
Workbench:

```
existing Workbench
  + embedded WebView2            (Chromium via the Edge runtime already on Windows — no bundled/forked Chromium)
  + a controlled browser session (persistent, authenticated, owned by the Work Order)
  + an observation/action adapter (CDP/Playwright: observe → propose → act, gated by authority)
  + Evidence/Authority integration (the record above, on every action)
```

Most of the hard pieces already exist: CDP-driven browsing, the Desk's live browser surfaces,
authority, evidence, receipts. The work is joining them into one coherent operator experience — the
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
