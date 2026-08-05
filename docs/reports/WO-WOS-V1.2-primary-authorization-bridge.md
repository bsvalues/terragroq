# WO-WOS-V1.2 Primary Authorization Bridge

Tracking issue: [#503](https://github.com/bsvalues/terragroq/issues/503)

## Outcome

WilliamOS can record one exact Primary decision from a direct, authenticated
Codex Desktop conversation without automating localhost, copying browser
cookies, inspecting credentials, or writing around the governed queue model.

The native bridge is intentionally narrower than a general command channel. It
accepts only the two fixed WilliamOS-native V1.2 campaign outcomes already
defined by issue #471:

- `campaign:v1-2:queue-evidence-drilldown`
- `campaign:v1-2:runtime-continuity-status`

## Identity binding

The bridge requires all of these signals to agree:

1. Codex App Server reports `chatgpt` authentication for the declared Primary
   email. Only account type, email, and auth-required state are read; no token,
   cookie, credential, or authentication cache is read or retained.
2. Codex App Server `thread/read` returns one pinned thread, turn, and direct
   user-message item. The bridge never accepts transcript content or identifiers
   from a caller.
3. The thread is an owner thread (`threadSource = user`) with no parent thread
   or agent role, and the completed turn timestamps are valid.
4. The App Server thread repository path exactly matches the canonical
   WilliamOS repository path.
5. The exact message matches a reviewed SHA-256 content digest. App Server's
   current protocol returns complete turn history for `thread/read`; the client
   therefore enforces a 512 MiB fail-closed frame limit, immediately projects
   the pinned item to its digest, and returns no raw conversation text to the
   authorization coordinator, persistence layer, or audit record.

This is an authenticated App Server and native-account trust anchor, not a
claim that Codex App Server provides a cryptographic message signature.
Subagent threads, substituted IDs or messages, repository mismatches, stale
consent, and account mismatches fail closed. Mutable local rollout JSONL is not
an authority source.

## Consent and mutation boundary

The reviewed authorization pin binds:

- the exact two outcome keys and their observed versions;
- one direct owner message digest;
- thread, turn, and message identifiers;
- a deterministic nonce derived from the pinned identifiers;
- the server-reported turn timestamp and a maximum 24-hour consent window.

The App Server verifier returns a module-branded object held in a private
`WeakSet`. The atomic writer rejects structurally identical caller-created
objects before opening a transaction, so the persistence function is not a raw
authority bypass.

The database mutation is one transaction. It locks the Primary identity and
queue, revalidates both canonical candidates, creates the exact existing
decision and authority-grant shapes, updates the queue, appends governance and
audit evidence, and writes exactly-once mutation receipts. Any failed invariant
or audit write rolls the transaction back.

Replay is accepted only when the request binding and the complete stored result
binding match and the exact decision, active grant, and approved queue state
still exist. Changed intent, version, decision reference, grant reference,
missing/revoked/expired authority state, or partial receipts fail closed.

The owner-message timestamp remains `ownerConsentIssuedAt`. Governance events,
event logs, and mutation receipts use the actual bridge transaction time as
`recordedAt`/`createdAt`; the audit trail is not backdated to the conversation.

## Expiration and revocation

The conversation consent expires before it can be consumed after its bounded
window. Each resulting campaign grant retains the existing 48-hour expiration
and existing Primary revocation path. Acquisition and lease renewal continue to
require an active, unexpired, unrevoked exact-scope grant.

## Safety boundary

- no localhost browser automation;
- no authentication bypass;
- no raw database maintenance command;
- no public or generic authorization endpoint;
- no password, cookie, token, session value, or auth-cache inspection;
- no new package, schema, environment, or Vercel setting;
- no TerraFusion, Property Workbench, TerraPilot, county/PACS, protected data,
  paid overage, destructive action, production mutation, or issue #357 reuse.
