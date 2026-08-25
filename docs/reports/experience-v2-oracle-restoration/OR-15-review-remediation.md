# OR-15 · Review remediation, measured

Six findings were raised on PR #1008 after its last substantive commit. Each is recorded below with
what was actually established about it, not with what it claimed. Four are repaired and measured;
two are typed rather than repaired, and the reason in each case is a boundary, not a disagreement.

Rollback captured before every ATLAS mutation:
`/tmp/or-rollback-iptables-20260825T104755.v4` (full `iptables-save`) and
`/tmp/or-rollback-apply-network-policy.sh` (`sha256 bbf75913…`, the deployed script as it was).

---

## 1 · The recorder would have minted a second grant · **REPAIRED, and the exact scenario re-run**

`OR-01-record-grant.mjs` guarded itself with `grantCovers`. Coverage is precisely what revocation
removes, so once `GRANT-0019` was revoked the guard stopped recognising it — and a re-run with
`--record` fell through to `createAuthorityGrantWithResult` and would have created a fresh **active**
`A3_WRITE_SHARED` grant under `#995`, with no owner decision behind it. The canonical path does not
prevent this either: its `reuseActiveScope` replay only matches `status = "active"`, and the recorder
does not pass it.

This was the single worst defect in the lane. Its consequence is not a wrong number in a report; it
is standing permission existing again after the record says it was deliberately closed.

The guard now asks a question revocation cannot erase — does a grant of this exact shape exist under
this scope for this actor, in **any** status — and it is asked before `--record` is consulted at all.
There is no override flag, deliberately.

Run against the live registry, with `--record`, which is exactly what the finding described:

```
mode              : RECORD
result            : ALREADY_ISSUED_HISTORICALLY
before.totalGrants: 29        after.totalGrants: 29
grant key present : false            (nothing was created)
GRANT-0019        : status revoked, covers=false, issuedByThisTool=true
```

`OR-16-recorder-replay-refused.json` is that run. `OR-17-registry-after-remediation.json` is a
separate observation taken after it: 29 rows, both digests unchanged, and the route's own lookup
still `accepted: false`.

## 2 · `URL.hostname` fails silently · **REPAIRED** — and it was worse than P2

The finding was filed as P2. Measured, it is the same defect class this whole lane exists to remove.

`URL.hostname` is a silent setter: given a value the parser will not take, it throws nothing and
leaves the **previous** hostname in place. The previous hostname is `192.168.88.5` — the address that
now belongs to a different device. So a registry holding a bare IPv6 literal produced:

```
returned url : postgresql://williamos:***@192.168.88.5:15432/williamos?sslmode=disable
reported host: "::1"          reported changed: true
```

A resolver whose entire contract is *never fall back to the written-down address* returning the
written-down address, while reporting success. Measured on this Node build:

| registry value | before | after |
| --- | --- | --- |
| `::1` | silently kept `192.168.88.5` | bracketed to `[::1]`, accepted |
| `fd00::1a66:daff:fe47:a033` (ATLAS has one) | silently kept `192.168.88.5` | bracketed, accepted |
| `atlas box` | silently kept `192.168.88.5` | `FABRIC_REGISTRY_HOST_UNUSABLE` |
| `192.168.88.8:9999` | silently kept `192.168.88.5` | `FABRIC_REGISTRY_HOST_UNUSABLE` |

Bare IPv6 is now bracketed rather than refused, and every remaining unusable value is a typed
refusal. The check offers the value to a throwaway URL carrying a sentinel host and reads rejection
as "the sentinel survived", because "did the hostname change" is not a usable test — a registry that
answers with the address the source already held is a no-op assignment and a success.

**A second measured fact worth writing down:** `postgresql:` is not a "special" scheme, so its host
is parsed as an *opaque host* — no lower-casing, no IDNA, and a different forbidden-character set
than a web URL. A hand-rolled `toLowerCase()` comparison would therefore have refused a registry
that writes `ATLAS`. Comparing against what the parser returns is what makes the check correct
rather than merely strict. Both behaviours are pinned in `tests/authority-registry-url.test.ts`.

## 3 · Applying the firewall could leave the port open · **REPAIRED, re-applied, re-measured**

`iptables -F "$CHAIN"` followed by rule-by-rule `-A` empties the **live** chain first. An empty
chain falls through to Docker's accept rules, so tcp/15432 was open to the LAN for the width of that
window — and open permanently if any single append failed, because `set -e` then exits with the
flush already done. Every command returns zero until the one that does not. The file's own header
says "NO FAIL-OPEN"; the apply body was written before the header.

Both properties of the replacement were measured on ATLAS on a scratch chain that nothing
references, rather than assumed:

```
--- chain declaration under --noflush REPLACES contents ---
before : -A WILLIAMOS-PROBE -p tcp -m tcp --dport 9  -j RETURN
after  : -A WILLIAMOS-PROBE -p tcp -m tcp --dport 10 -j RETURN     (the dport 9 rule is gone)

--- a bad rule mid-input commits NOTHING ---
iptables-restore v1.8.10 (nf_tables): unknown option "--this-is-not-a-match"
Error occurred at line: 4
after  : -A WILLIAMOS-PROBE -p tcp -m tcp --dport 10 -j RETURN     (unchanged, not partial)
```

The policy is now one `iptables-restore --noflush` transaction: it either becomes the new policy or
stays the old one, and is never absent in between. `apply` re-reads what it installed and exits
non-zero on any difference; a missing `iptables-restore` is a refusal rather than a silent downgrade
to the unsafe method.

Re-applied on ATLAS with the fixed script, and the result is byte-identical to the policy that was
already in force:

```
check BEFORE : POLICY_OK: tcp/15432 allowlisted to: 192.168.88.9/32 (everything else dropped)
apply        : POLICY_APPLIED  (rc=0)
check AFTER  : POLICY_OK       (rc=0)
diff of WILLIAMOS-AUTHORITY + DOCKER-USER rules vs the pre-change snapshot:
               IDENTICAL_TO_PRE_CHANGE_POLICY
```

Refusal controls re-run against the new apply path, both leaving the policy intact:

```
caller with no cidr  -> CALLERS_FILE_INVALID (rc=1)   then check: POLICY_OK
empty caller list    -> CALLERS_FILE_INVALID (rc=1)   then check: POLICY_OK
```

The boot-time owner was then restarted, so the unit's own environment ran the new script rather than
only an interactive shell doing so:

```
systemctl restart williamos-authority-firewall  -> rc=0, active, enabled
journal: POLICY_APPLIED: tcp/15432 allowlisted to: 192.168.88.9/32 (everything else dropped)
         POLICY_OK      (the ExecStartPost check)
         Finished williamos-authority-firewall.service
```

The declaration and the deployment are the same bytes — checked rather than assumed, because a repo
file that has drifted from the machine is the shape of the original defect:

```
repo working tree : fc771be2a9740fcf58f588f0547bbc00f8e3779082352789dc507cf34b200a75
git object at HEAD: fc771be2a9740fcf58f588f0547bbc00f8e3779082352789dc507cf34b200a75
deployed on ATLAS : fc771be2a9740fcf58f588f0547bbc00f8e3779082352789dc507cf34b200a75
```

Measured from both sides afterwards:

```
OMEN   -> 192.168.88.8:15432   NO CONNECTION (silently dropped; 6015 ms, no RST)
OMEN   -> 192.168.88.8:5432    CONNECTED     (TerraFusion, deliberately outside this policy)
HERMES -> 192.168.88.8:15432   CONNECTED     (the one allowlisted caller)
HERMES -> 192.168.88.8:5432    CONNECTED
```

The blast radius is still one port: ATLAS's other published services are unaffected.

## 4 · The `--out` file's mode · **REPAIRED**

`fs.writeFileSync(out, body, { mode: 0o600 })` applies `mode` only when it **creates** the file.
Writing over an existing `0644` path truncated it, wrote the registry password into it, and left it
world-readable — the failure landing on the second and every subsequent run, which is the common
case for a file whose entire purpose is to be generated per run. The previous file is now removed
first and the mode asserted on the descriptor rather than requested.

POSIX modes are meaningful on the CI runner and on ATLAS and are not on the Windows machines this
was developed on, so the assertion is in CI where it means something: three cases in
`tests/authority-registry-url.test.ts` spawn the real CLI, over a pre-existing `0644` file, over no
file, and against a registry that cannot answer (which must write nothing at all rather than leave
a previous answer looking current).

Exercised live on HERMES over a pre-existing file, through the real path:

```
{"resolvedFrom":"C:\\Users\\bs\\.williamos\\fabric","nodeId":"atlas",
 "registryFingerprint":"c05bdf932c7d6172affccea36217b1aef68a5baf15e9e585c12785131cc32711",
 "previousHost":"192.168.88.5","host":"192.168.88.8","changed":true,...}
```

## 5 · The digest omitted three columns · **CORRECTED, and the claim narrowed**

The finding is right and the wording it corrects was mine: the tool said it digested "every column
that carries meaning" and digested 15 of the table's 18. `reason`, `revokedBy` and `revokeReason`
were absent.

What that does and does not undermine, stated exactly:

- `revokedBy` and `revokeReason` are only ever written by `revokeAuthorityGrant`, in the same
  statement as `status` and `revokedAt` — **both digested**. A revocation cannot hide in them.
- `reason` is different. Nothing in the canonical path updates it after creation, but an ad-hoc
  `UPDATE` could rewrite it without moving `contentHash`, because that column *stores* a hash rather
  than recomputing one. A `reason` rewrite was genuinely invisible to the 15-column digest.

Extending the column list in place would have been the wrong repair: the pre-mutation baseline was
captured over those 15 columns, and a digest over 18 cannot be compared with it. Silently changing
what a digest covers, in the file whose purpose is proving nothing changed, is the same class of act
as the defect. So the 15-column digest is kept exactly as it was and an 18-column digest is reported
**alongside** it as the forward baseline.

```
28 pre-existing grants, 15 columns : dba0006cc86c4c35abc7d2fc58b00cacb38c03bd5698439e3c2e4ce6128353b7
28 pre-existing grants, 18 columns : e458f4bc16f24ab8ee3ef20388d2f3afaa4ae5a95d14f8a68d9cbc650da3e36f
all 29 grants,         15 columns : 60a107a4c047ab57ab6852c3810a524c545bb26f8b675abb2c37661d1522cb7c
all 29 grants,         18 columns : 73747e267954b410f59ceac6c47fdf765e53a85a3d7a19de6b194999f9a95a2e
```

The 15-column figure was **re-derived independently in this session** — `psql` on ATLAS over the
container's local socket, against the node-pg reading taken from HERMES before this lane touched
anything — and matches `dba0006c…` exactly. Two tools, two transports, two sessions.

## 6 · The resolver has no production caller · **TYPED, NOT REPAIRED — and this is a boundary**

The finding is factually correct and was verified rather than accepted: a repository-wide search
finds the resolver reachable only from its own CLI and its tests. `scripts/hermes-bridge/run-cycle.ps1`
still starts every cycle from the durable `.env.local`, so a normal HERMES restart goes on using the
address that stopped existing.

It is not repaired here, for two reasons that are about scope rather than about difficulty:

1. **This lane's HERMES-side envelope is reads and the driver run.** Wiring the resolver into the
   runtime's startup is a production behaviour change to a service other lanes may be using.
2. **It would not work if it were wired.** `CONT-EXPV2-RUNTIME-CREDENTIAL-STALE`: the live runtime's
   `.env.local` does not carry the `williamos` role's password, so that process cannot read the
   authority registry whatever address it resolves. Wiring the resolver in now would replace a
   visible wrong address with an invisible wrong credential, and would look like a repair.

Typed as **`CONT-EXPV2-RESOLVER-NOT-WIRED`**, and it should be closed together with
`CONT-EXPV2-RUNTIME-CREDENTIAL-STALE` by a lane that owns the runtime, not alongside it.

---

## What did not change

`CONT-EXPV2-AUTHORITY-REGISTRY-SINGLE-POINT` stays typed open. `GRANT-0019` stays revoked, and this
remediation created no grant — the one run that tried, with `--record`, is the evidence in item 1.
The 28 pre-existing grants are unchanged by every digest available, old and new.
