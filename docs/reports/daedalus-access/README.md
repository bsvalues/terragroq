# DAEDALUS SSH enrollment

Prepared September 9, 2026. **Not run on DAEDALUS.** The script does not establish enrollment until a local invocation succeeds and HERMES independently verifies SSH access.

DAEDALUS's authenticated Codex task history records `enp1s0` at `192.168.88.6/24`, with a link-local IPv6 address corresponding to MAC `04:7b:cb:a5:34:65`. HERMES's current neighbor entry matches that MAC. A strict SSH connection from HERMES to that address was refused before authentication. No DAEDALUS SSH host key is currently pinned in HERMES's fabric known-hosts file.

Once local execution is available, an agent runs:

```sh
sudo bash scripts/fabric/enroll-daedalus.sh --public-key /path/to/williamos-fabric.pub
```

The input is the **public** half of HERMES's existing fabric service key. Never copy the private key. If OpenSSH server is absent, the explicit `--install-openssh` option permits Ubuntu package installation. Package installation can start its default service. The script preserves SSH policy and firewall rules; any pre-existing exposure is unchanged, except that starting an inactive service activates its existing listeners.

Enrollment appends one source-restricted service-key entry to `/home/daedalus/.ssh/authorized_keys`, preserves other entries, and refuses a duplicate service key with different restrictions. It grants no sudo rights. It enables the existing `ssh` service and emits configured host public keys/fingerprints, machine-ID SHA-256, and interface addresses.

HERMES must receive that public receipt through an authenticated channel, pin the independently verified host key through its existing fabric enrollment path, and execute a strict-host-checking probe with the fabric service key. A key obtained only by unauthenticated `ssh-keyscan` is insufficient to establish identity. Registry eligibility remains separate from this access bootstrap.

Local verification: `bash -n scripts/fabric/enroll-daedalus.sh` passed under Git Bash. No Linux service, package, firewall, or account mutation was exercised by that syntax check.
