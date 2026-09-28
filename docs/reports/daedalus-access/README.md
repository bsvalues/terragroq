# DAEDALUS SSH enrollment

Updated September 9, 2026. **Live SSH and default SCP roundtrip verified.** The root enrollment script below was not run. The actual bootstrap uses a user-owned SSH daemon on port 2222.

## Observed live bootstrap

HERMES's `ssh daedalus` alias uses the existing fabric service key, batch authentication, and strict checking against the pinned `daedalus` host identity. It reaches `daedalus@192.168.88.6:2222`. The configured ED25519 fingerprint is `SHA256:njnjHfmzEA8Azl5xOcNICR4V3OU7+DvUO4JLHW4AAf4`. The machine-ID hash, after removing its trailing newline, is `cc4b1b2b7b646030b222edd2e24ef3711c3621af06b21555355fef718889effb`.

The user service `williamos-daedalus-sshd.service` is enabled and active. `loginctl` reports `Linger=yes`. A real service restart closed the control connection; a new strictly pinned SSH connection succeeded, and the listener PID changed from 627563 to 631021. A second restart after enabling internal SFTP produced PID 631380 and another successful connection. This verifies service restart recovery; a machine reboot was not performed.

The live configuration disables password and keyboard-interactive authentication, disables root login, allows only `daedalus`, and uses strict key-file permissions. The installed fabric key permits source `192.168.88.9` and disables agent, X11, and port forwarding. The listener binds `0.0.0.0:2222`; source restriction is enforced by the authorized key, not a newly installed firewall rule. No sudo grant was added.

Added `Subsystem sftp internal-sftp` to this user-owned daemon configuration, validated it with its own `sshd -t`, and restarted the service. Default `scp` uploaded and downloaded the acceptance receipt successfully, with matching SHA-256 `DEB0A728D81891DF99641B38C4C74B60FD221B79F5B1B404B96E536FC2B33C2B`. The receipt also records the RTX 3090 UUID and driver observed through the restarted connection.

Machine-readable live receipt: `C:\HermesLab\daedalus\ssh-acceptance.json`. The returned file is retained at `C:\HermesLab\daedalus\ssh-acceptance-roundtrip.json`. The live unit and SSH configuration reside under `/home/daedalus/.config/systemd/user/` and `/home/daedalus/.local/share/williamos-daedalus/ssh/`. Noninteractive SSH does not set `XDG_RUNTIME_DIR`; service diagnostics set it to `/run/user/$(id -u)` before using `systemctl --user`.

## Prepared alternative root enrollment script

DAEDALUS's authenticated Codex task history records `enp1s0` at `192.168.88.6/24`, with a link-local IPv6 address corresponding to MAC `04:7b:cb:a5:34:65`. HERMES's neighbor entry matched that MAC. Before the port-2222 bootstrap, a strict SSH connection to port 22 was refused before authentication and no DAEDALUS host key was pinned.

Once local execution is available, an agent runs:

```sh
sudo bash scripts/fabric/enroll-daedalus.sh --public-key /path/to/williamos-fabric.pub
```

The input is the **public** half of HERMES's existing fabric service key. Never copy the private key. If OpenSSH server is absent, the explicit `--install-openssh` option permits Ubuntu package installation. Package installation can start its default service. The script preserves SSH policy and firewall rules; any pre-existing exposure is unchanged, except that starting an inactive service activates its existing listeners.

Enrollment appends one source-restricted service-key entry to `/home/daedalus/.ssh/authorized_keys`, preserves other entries, and refuses a duplicate service key with different restrictions. It grants no sudo rights. It enables the existing `ssh` service and emits configured host public keys/fingerprints, machine-ID SHA-256, and interface addresses.

HERMES must receive that public receipt through an authenticated channel, pin the independently verified host key through its existing fabric enrollment path, and execute a strict-host-checking probe with the fabric service key. A key obtained only by unauthenticated `ssh-keyscan` is insufficient to establish identity. Registry eligibility remains separate from this access bootstrap.

Local verification: `bash -n scripts/fabric/enroll-daedalus.sh` passed under Git Bash. No Linux service, package, firewall, or account mutation was exercised by that syntax check.
