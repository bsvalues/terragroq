# AEGIS remote-development address reconciliation

**Work Order:** `WO-TF-REMOTE-DEV-OFFLOAD-001`

**Status:** reviewed package correction; execution remains inactive

**Scope:** active proof-specific transport only

## Current topology binding

- Hermes forced-command source: `192.168.88.9`
- AEGIS operator target: SSH alias `aegis`, resolving on Hermes to `192.168.88.6`
- AEGIS machine identity SHA-256: `1b490fe20bf3d61dc1f14e3a6e7fe38fc7de69c14face211fdd5afd0544c9c8b`
- The existing reviewed Hermes and AEGIS host keys remain binding; an address move does not authorize a key change.
- OMEN still reaches the worker only through Hermes. No direct OMEN-to-AEGIS execution lane is introduced.

## Exact predecessor reconciliation

The root adapter accepts the prior `from="192.168.1.154"` forced-command entry only when its complete key and restriction bytes and root-owned metadata match the reviewed predecessor. Before atomic replacement, it writes and fsyncs a root-only transaction-bound predecessor snapshot. Any extra line, different key, different restriction, symlink, ownership/mode drift, or other occupied state remains `TRANSPORT_DRIFT`.

The new entry allows only source `192.168.88.9` and retains the fixed forced command, public-key-only authentication, no PTY, no forwarding, no agent/X11 forwarding, and no unrestricted shell.

## Frozen historical authority

The closed `WO-EF-DISPATCH-AEGIS-001` standing-HASH package, source `192.168.1.154` evidence, canonical runner, claim, lease, release, and replay evidence remain byte-for-byte unchanged. Their historical address is evidence, not current remote-development authority.

## Live gate

Before applying a fresh merged generation, Hermes must prove that alias `aegis` resolves to `192.168.88.6` with strict host-key checking and the already reviewed AEGIS key. The fixed root handoff may then reconcile only the exact predecessor transport under a fresh single-use authority. It remains non-authorizing: no workspace, dispatch, scheduler, or standing execution authority is created.
