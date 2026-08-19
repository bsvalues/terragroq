# OMEN off-site cockpit transport

Reachability for the WilliamOS cockpit from OMEN when OMEN is not on the lab LAN, serving
[#858 `OMEN_OFFSITE_REMOTE_DEV_ACCEPTANCE`](https://github.com/bsvalues/terragroq/issues/858).

Until this landed, the configuration existed only as ad-hoc `netsh` and hosts-file state on two
machines. That is the same debt shape as `sync-models-to-forge.ps1` living only on HERMES and the
deployed control plane having no source of truth in git: it works until the machine is rebuilt, and
then nobody can say what it used to be.

## What this is, and what it is not

Tailscale provides **reachability only**. WilliamOS authentication is completely unchanged: OMEN still
presents its device certificate to HERMES's own TLS proxy and gets a session exactly as it does on the
LAN. The overlay is not a trust boundary, not an authentication mechanism, and not a substitute for
one.

The relay is deliberately a **TCP** forward. TLS -- including the client certificate carrying OMEN's
device identity -- is negotiated end to end between OMEN and `hermes-https-proxy`. Nothing in the path
terminates, decrypts, or inspects it.

> **Do not replace this with cloudflared or any TLS-terminating tunnel.** Terminating TLS at a
> provider destroys the `x-williamos-device-cert` proof while every health check keeps returning 200.
> The failure would be invisible and would look like success.

## Scripts

| Script | Runs on | Purpose |
|---|---|---|
| `hermes-cockpit-relay.ps1` | HERMES, elevated | portproxy from the overlay address to the LAN bind, plus a narrowly scoped inbound rule |
| `omen-cockpit-route.ps1` | OMEN, elevated | resolve `williamos.lan` to the overlay address (`-Restore` reverts to the LAN) |
| `verify-cockpit-transport.ps1` | OMEN | prove both paths authenticate **and** that an uncertificated request is still refused |

All three are idempotent and verify their own result rather than trusting the command's exit code.

## Why `hermes-cockpit-relay.ps1` exists instead of a one-line code change

`scripts/hermes-https-proxy.mjs` hardcodes `HERMES_HTTPS_HOST = "192.168.88.9"`, so the listener binds
the LAN interface only and the overlay address cannot reach it. Editing that constant is a
control-plane change owned by the HERMES lane while #871 is the active gate there, so reachability is
solved outside the application. If that bind ever becomes configurable, this relay should be removed
rather than kept as a second mechanism.

## The control case is the assertion that matters

`verify-cockpit-transport.ps1` makes a third request over the overlay **without** a client certificate
and requires it to be refused a session. Checking only that the cockpit answers would report green
just as loudly if the relay had started handing sessions to anyone who connected. A transport change
that quietly becomes an authentication bypass passes every test that does not include a control.

The script also distinguishes *unreachable* from *bypassed*. Those are different findings and
collapsing them either cries wolf or hides a breach.

## Operational notes

- **Both `Tailscale` and `iphlpsvc` must be `Automatic` on HERMES.** portproxy is implemented by
  `iphlpsvc`; if it is not automatic the relay silently disappears at the next reboot. The relay script
  asserts this rather than assuming it.
- **Node keys expire 2027-02-15.** Expiry is a silent break: the cockpit simply becomes unreachable,
  most likely while travelling. Re-authenticate before then or disable key expiry for these two nodes.
- **Tradeoff, accepted deliberately:** because `williamos.lan` now resolves to the overlay, the cockpit
  is reached over Tailscale even at home, so a Tailscale outage makes it unreachable from three feet
  away. `omen-cockpit-route.ps1 -Restore` reverts that.
- **`CRYPT_E_NO_REVOCATION_CHECK` is not a trust failure.** This private CA publishes no CRL/OCSP, so
  strict Schannel revocation checking fails on a perfectly valid certificate. Use
  `--ssl-revoke-best-effort`, and use `C:\Windows\System32\curl.exe` rather than the Git Bash build,
  which carries its own CA bundle and can see neither the client certificate nor the trust chain.
  This has already been misread as a broken certificate twice.

## Scope actually proven

Verified on-LAN 2026-08-19: both paths return `303 -> /` with a session cookie, the uncertificated
control is refused with `303 -> /sign-in`, 147 ms to first byte over the overlay. Both nodes reach the
Seattle DERP relay (11.6 ms / 8.3 ms) and report `MappingVariesByDestIP: false`, so direct NAT
traversal off-site is likely with relay fallback available.

**Not proven, and not to be reported as proven:**

1. **The genuinely off-LAN case.** While OMEN sits on the lab LAN, Tailscale uses the direct path
   (`curAddr=192.168.88.9:41641`) and will not downgrade to a relay while that path works. An attempt
   to force the relay by blocking the LAN WireGuard endpoint did not change the selected path, so it
   demonstrated nothing. This requires physically leaving the network.
2. **Disconnect/reconnect continuity** -- power OMEN down mid-job, have HERMES/AEGIS finish it, then
   reconnect off-site to the same Thread and evidence. That needs the resident continuation path
   (#870) and is not a transport property.

Transport is a precondition for #858, not its acceptance.
