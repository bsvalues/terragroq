# AI Eval-Ops live staging preflight — 2026-08-11

Result: `BLOCKED_PREFLIGHT / HERMES_OBSERVED_UNSAFE / ATLAS_UNREACHABLE / AEGIS_UNRESOLVED / NO_MUTATION`.

This was a read-only discovery pass for the proposed WO-AEH-022/024 staging change. It grants no authority and performs no installation, service, credential, database, firewall, network-policy or host mutation.

## Hermes — freshly observed

Observed at approximately 2026-08-11 17:55 America/Los_Angeles.

- Host: `Hermes`; Windows 10 Pro `10.0.19045` x64; last boot approximately 2026-08-10 12:35 local.
- Windows Time is stopped/manual and `w32tm /query /status` fails with service-not-started. Current time synchronization is not proven.
- Ollama is loopback-only on `127.0.0.1:11434`; API version `0.32.5`.
- Installed model: `llama3.2:3b`, digest `a80c4f17acd55265feec403c7aef86be0c25983ab279d83f3bcd3abbcb5b8b72`, 2,019,393,189 bytes.
- Ports 3000, 5433, 6379 and 9000 are published on all interfaces through Docker/WSL. These management/data exposures are outside the worker contract and block staging until separately contained or explicitly accepted.
- Containers are running from mutable references: `ollama/ollama:latest`, `ghcr.io/open-webui/open-webui:main`, `portainer/portainer-ce:latest`, `postgres:16`, and `redis:7`.
- Capacity snapshot: i7-5960X 8C/16T; 34,263,711,744 bytes RAM with 10,263,871,488 free; RTX 3050 6144 MiB with 5025 MiB free, 28C and 25% utilization.
- `HermesLabHealth` last result is `2`; backup tasks last returned `0`. No native WilliamOS/Hermes worker service exists.
- HermesLab base is `0481061acf1f683688a00b09795647d0288c7232` and materially dirty. terragroq review base is `13709f5789c25dea408283730a6bd35e8fd894ab` and materially dirty.

Relevant packaging hashes observed:

- Hermes release manifest: `0eca1d06e7e0390452d898659653d347595911ac8a838cfbabb12a84901eb98a`
- Hermes validation SBOM: `89e4b2c0ecf3b78682ef5cd7e1064965b25a198774c268535c22aed4089ac3c7`
- Disabled task definition: `b59323ead265ad187d55579af262c41c4d727971568a32dbe26601623d59d06d`
- Hermes package module: `798d8e1eecccf7018c2c2fb6ede1c416d675a8fac8e4b6b8b4f61559127a5fa8`

## Atlas — fresh discovery unavailable

- No usable SSH alias is configured.
- The historical endpoint `bs@192.168.1.156:22` timed out under noninteractive, identities-only access.
- No hostname, machine/boot identity, time, PostgreSQL, TLS, ACL, schema, capacity or backup fact was freshly established.
- Historical documentation remains stale evidence and cannot authorize deployment.

## AEGIS — fresh discovery unavailable

- The `aegis` alias does not resolve and no user SSH config exists.
- Historical IPs, usernames, keys or credentials were not guessed or scanned.
- No hostname, machine/boot identity, systemd/cgroup, resource, listener, mount or backup-boundary fact was freshly established.

## Blocking verdict

Do not open the live change window. Before R3 approval or mutation:

1. Restore and prove Hermes time synchronization.
2. Resolve the failing `HermesLabHealth` result.
3. Contain or explicitly and separately accept the all-interface 3000/5433/6379/9000 exposures.
4. Replace mutable runtime references with approved immutable image/runtime digests.
5. Establish current authenticated, host-key-pinned access and fresh identity/readiness evidence for Atlas and AEGIS.
6. Reconcile dirty repository/host artifact scope and render production release/config/unit hashes.
7. Fill every owner decision field in the live staging change request and obtain separate WO022 and WO024 R3 grants.

No issue #357 path was used. Scheduler, workers, runtime and production authorization remain inactive.
