# OR-07 — the pre-grant settlement run, and the artifact that is missing

Between restoring the oracle and recording the grant, `RS-00-settle-stamp-identity.mjs` was run
against the repaired transport with no `#995` grant in existence. It is the run that separates the
two walls: it proves the registry became *readable* while the mutation stayed *refused*.

Its verdict was:

```
verdict   : BLOCKED_AT_AUTHORITY:AUTHORITY_NOT_GRANTED_NO_ROWS
authority : registryReadable true, userScoped true, grantsFound 0, grantRef null
mutation  : executed false, nodeContacted false, refusedAt "authority"
ledger    : 1241147 bytes before and after
stamp     : absent before and after
```

**Its full JSON did not survive.** The run was written to a session scratch directory under
`%TEMP%`, and that directory was removed by the host's temp cleaner before the file was moved into
this repository. Every later run was captured directly into the lane's durable working directory
instead. This note exists because a gap between `OR-06` and `OR-08` with nothing said would look
worse than the loss is, and because an evidence set that quietly omits its inconvenient index
entries is not an evidence set.

What still stands on its own:

- **`OR-06-grants-before.json`** is the same registry state, read through the route's *own*
  predicate (`"scope" = $1 AND "userId" = $2`) and the canonical `grantCovers`, and it records
  `count: 28`, `rowsReturned: 0`, `accepted: false`, enumeration digest
  `dba0006cc86c4c35abc7d2fc58b00cacb38c03bd5698439e3c2e4ce6128353b7`. That digest is byte-identical
  to the baseline taken on ATLAS by `psql` before this lane touched anything — two tools, two hosts,
  two transports, one number.
- The driver's verdict lattice is deterministic on that state: zero rows for the scoped actor is
  `AUTHORITY_NOT_GRANTED_NO_ROWS` and nothing else.
- **`OR-12-closed.json`** is the same driver refusing again after revocation, with `grantsFound: 1`
  and `covers: false` — the neighbouring state, captured in full.

So the finding is corroborated and the *artifact* is not recoverable. Both of those are true and
both are written here.
