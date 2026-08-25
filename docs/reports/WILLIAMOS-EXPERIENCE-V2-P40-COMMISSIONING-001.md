# WilliamOS Experience V2 — HERMES P40 Commissioning 001

Status: `HERMES_P40_BLOCKED_RUNTIME` *(provisional — see "Disposition")*

Issue: `#997 HERMES_P40_COMMISSIONING` · Parents `#990` Gate 1 packet, `#985` System Object Graph,
`#964` Intelligence Fabric V1 · Prerequisite settlement `#998` (Gate 1b, live)

Worked from merged `main` `053a33bdb3bb1db57db6d85fff96163b68f11b22`, in an isolated worktree.
Every read and every write against HERMES went through `lib/fabric/broker.mjs`; SSH carried files and
started `node`, and produced no fact recorded here.

`OWNER_COURIER_ACTIONS = 0`.

## Result in one paragraph

The commissioning target was reconfirmed on live hardware and then the lane stopped, twice, on things
that were true before it arrived. **The Ollama service #997 asks me to reconfigure is not running.**
It exited at `2026-08-25T00:48:19Z` with `ExitCode 128` and the NVIDIA container hook's
`nvml error: unknown error`, and it has been down since — which is the same absence Gate 1b recorded
as `CONT-EXPV2-HERMES-OLLAMA-NOT-OBSERVED`, now with a cause attached. **The canonical owner of that
service is `C:\HermesLab\hermes\docker-compose.yml`, and the container that was running is not the
container that file describes**: it carries no compose labels, binds a model-store path that does not
exist on the machine, and published port 11434 on every interface in violation of the node's own
declared `ollama-loopback-only` constraint. Two owner-supplied expectations did not survive contact
with observation — the 150 W cap is **not** in effect (the card reads 250 W enforced) and
`F:\HermesData\ollama` **does not exist**. Rollback was captured in full before anything was touched,
and then nothing was touched: HERMES left the network at approximately `2026-08-25T01:35Z`, before the
container-isolation test that would have decided whether a TCC-mode P40 can be reached through Docker
Desktop's WSL2 backend at all. No mutation was performed. The P40 remains at `capability: UNKNOWN`.

## Discipline this lane held to

- **Ownership inspected before Docker.** The ownership determination below was completed *before* any
  mutation was planned, and it changed the plan: the obvious `docker rm && docker run --gpus device=…`
  fix would have been erased by the next `docker compose up -d`, which #997 names as an acceptance
  invariant rather than a nuisance.
- **Rollback captured before mutation.** Full `docker inspect` of the container, its image, the proxy
  and open-webui were written to disk before the mutation plan was finalised, and the mutation never
  ran. The rollback receipt is therefore complete and untested — stated as such, not as proven.
- **Expectations verified, not trusted.** Six of the owner's expectations held exactly; two did not.
  The two that did not are recorded as observations winning over declarations, not as errors.
- **Discovery, not declaration.** No seed, registry, pin or inventory was edited. #990 still owns
  discovery. The P40's identity here is the one `#998` settled, re-observed fresh.
- **Nothing declared about hardware by this lane's tooling.** `P40-brokered.mjs` and
  `P40-run-canonical-probe.mjs` contain no device name, UUID, VRAM figure or power number — grep them.

## Step 1 — current truth, bound through the canonical brokered path

`scripts/execution-fabric/probe-windows.ps1`, digest `fe07b7b7…`, byte-identical to merged `main`
`053a33bd` on both ends, invoked through `brokeredExec` as action `probe`. All ten canonical files
were digest-verified on HERMES before anything ran (`P40-canonical-file-digests.txt`).

- brokered invocation: `2026-08-25T01:24:13.020Z` → `01:24:22.046Z`, 9 025 ms, 21 021 bytes,
  `stderr: null`, `rc=0`
- probe's own `observed_at`: `2026-08-25T01:24:13.2966005Z`
- node identity: `hermes-node` / `HERMES`, `machine_id_sha256 7d1d7ef856…`, evidence
  `confidence: "observed"`

### Both accelerator identities

| | RTX 3050 | Tesla P40 |
| --- | --- | --- |
| uuid | `GPU-6d9ae165-7272-a38c-06b1-7276869e980f` | `GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2` |
| pci bus id | `00000000:01:00.0` | `00000000:02:00.0` |
| vram total | 6 442 450 944 B (6 144 MiB) | 24 159 191 040 B (23 040 MiB) |
| vram used | 811 597 824 B | 9 437 184 B |
| vram source | `nvidia-smi` | `nvidia-smi` |
| driver | `560.94` | `560.94` |
| temperature | 31 °C | 29 °C |
| utilization | 1 % | 0 % |

Both UUIDs match the owner's expectation exactly. The P40 is the identity `#998` settled; this lane
consumed it and did not re-describe it.

### Supplementary telemetry the canonical probe does not carry

`probe-windows.ps1` queries eight `nvidia-smi` fields and stops there, so PCIe link state, ECC, power
envelope, BAR1 and driver model had to be read separately. That read also went through `brokeredExec`
(action `probe`) so it is ledgered, but it is **supplementary evidence, not a canonical registry
input** — nothing here feeds the snapshot.

| Property | RTX 3050 | Tesla P40 |
| --- | --- | --- |
| driver model | WDDM (pending WDDM) | **TCC** (pending TCC) |
| display mode / active | Enabled / Enabled | Disabled / Disabled |
| compute mode | Default | Default |
| pcie link gen cur/max | 3 / 3 | **1 / 3** |
| pcie link width cur/max | 8 / 16 | **16 / 16** |
| BAR1 total | 256 MiB | **32 768 MiB** |
| power draw | 7.98 W | **10.06 W** |
| power limit enforced | 70.00 W | **250.00 W** |
| power limit default / min / max | 70 / 20 / 70 W | 250 / 125 / 250 W |
| ECC mode | N/A | **Enabled** (pending Enabled) |
| ECC volatile SBE / DBE | N/A | **0 / 0** |
| ECC aggregate SBE / DBE | N/A | **6 / 0** |
| shutdown temp | 97 °C | **95 °C** |
| slowdown temp | 94 °C | **92 °C** |
| throttle reasons active | `0x1` (GPU idle) | `0x4` (SW power cap) |
| serial | N/A | `0324017002735` |
| board part number | N/A | `900-2G610-0000-000` |
| compute apps attached | 23 (dwm, explorer, browsers, Docker Desktop, …) | **none** |

### Owner expectations, checked one at a time

| # | Expectation | Observed | Verdict |
| --- | --- | --- | --- |
| 1 | RTX 3050 `GPU-6d9ae165-…` | identical | **HOLDS** |
| 2 | P40 `GPU-4f7d4396-…` | identical | **HOLDS** |
| 3 | P40 in TCC | `Driver Model: Current TCC` | **HOLDS** |
| 4 | ~23 040 MiB usable VRAM | 23 040 MiB, `nvidia-smi` measured | **HOLDS** |
| 5 | PCIe x16 | width `16/16` | **HOLDS (width)** — link *gen* reads 1 of 3 at idle; that is expected ASPM downclock and is only meaningful under load, which this lane never reached. Recorded `UNKNOWN`, not inferred. |
| 6 | BAR1 32 GB / Above-4G functioning | BAR1 total 32 768 MiB | **HOLDS** |
| 7 | idle ≈ 34 °C / 10 W | 29 °C / 10.06 W | **HOLDS** (temperature lower than expected, power on the nose) |
| 8 | Docker / WSL virtualization restored | docker 29.7.2 running, wsl running | **HOLDS at the daemon level** — and *not* at the GPU level; see step 3 |
| 9 | existing Ollama container exposes all GPUs | `NVIDIA_VISIBLE_DEVICES=all`, `DeviceRequests count -1` | **HOLDS** |
| 10 | API contract `11434:11434` | live container published `11434→11434` | **HOLDS for the live container — and the live container is the drift**; the owning compose file says `127.0.0.1:11434:11434`. See the port defect below. |
| 11 | **temporary 150 W cap already applied** | `enforced.power.limit = 250.00 W`, `default = 250.00 W`, samples avg 9.85 W over 116.9 s | **DOES NOT HOLD** |
| 12 | **model store `F:\HermesData\ollama`** | `Test-Path F:\HermesData\ollama` → **false** | **DOES NOT HOLD** |

Expectations 11 and 12 are the two where canonical live observation wins, per #997. Neither was
forced to match; both are recorded as differences.

**On 11.** The 150 W cap is not present. Nothing in the evidence says it was never applied — a power
limit set with `nvidia-smi -pl` does not survive a driver reload or reboot unless persistence mode
holds it, and persistence mode reads `N/A` on this Windows host for both cards. The honest claim is
*the cap is not in effect at `2026-08-25T01:24Z`*, not "the owner was wrong". #997 §4 requires it to
be applied before load, and this lane did not reach load.

**On 12.** See the model-store section — this is the more serious of the two.

## Step 2 — ownership determination (done before touching Docker)

**The canonical owner is `C:\HermesLab\hermes\docker-compose.yml`, compose project `hermes`,
compose v2.40.3 — and the Ollama container that was running is not the one it describes.**

Four of the five services in that file carry the compose labels that prove ownership:

| container | `com.docker.compose.project` | `…project.config_files` |
| --- | --- | --- |
| `postgres` | `hermes` | `C:\HermesLab\hermes\docker-compose.yml` |
| `redis` | `hermes` | `C:\HermesLab\hermes\docker-compose.yml` |
| `open-webui` | `hermes` | `C:\HermesLab\hermes\docker-compose.yml` |
| `portainer` | `hermes` | `C:\HermesLab\hermes\docker-compose.yml` |
| **`ollama`** | **— absent —** | **— absent —** |

`ollama`'s entire label set is `{"org.opencontainers.image.version":"24.04"}`: the image's own label
and nothing else. It was created `2026-08-18T20:42:32Z` by hand and attached to both `bridge` and
`hermes_default`. The compose file *does* define an `ollama` service with `container_name: ollama`,
and `open-webui` carries `com.docker.compose.depends_on: "ollama:service_started:false"` — so compose
believes it owns that service, and the name it would claim is already taken by a container it did not
create.

**This settles the acceptance invariant in #997's own terms.** A `docker rm ollama && docker run
--gpus '"device=GPU-4f7d…"' …` would have worked, proved isolation, and been erased the next time
anyone ran `docker compose up -d` in `C:\HermesLab\hermes`. The change belongs in the compose file.

### Three drifts between the owning layer and what was running

| | compose file (owner) | live container (observed) |
| --- | --- | --- |
| model store | `D:/HermesData/ollama:/root/.ollama` | `F:/HermesData/ollama:/root/.ollama` |
| port publish | `127.0.0.1:11434:11434` | `11434:11434`, `HostIp: ""` → all interfaces |
| GPU request | `deploy…devices: [{driver: nvidia, count: all, capabilities: [gpu]}]` | `DeviceRequests count -1` **plus** `NVIDIA_VISIBLE_DEVICES=all` |

The compose file's own header comment reads *"Ollama models (the big files) are bind-mounted to
`D:\HermesData\ollama`"*, and its port line is commented *"Loopback-only publish: reachable on the
host (127.0.0.1) for OMEN's SSH tunnel, NOT exposed on the LAN."* Both comments describe the
governed intent. The running container matched neither.

### Secondary owners: none found, none ruled out

Compose ownership is established by label evidence. What is **not** established is whether some
*other* layer also claims this service, because the read that would have answered it — Windows
services, scheduled tasks, host `ollama.exe` processes, and the contents of the candidate scripts —
was the read HERMES went offline during. It never returned, and nothing here should be read as
clearing it.

Named candidates, all present in `C:\HermesLab\hermes` and all **uninspected**: `start-hermes.ps1`,
`run-all.ps1`, `model-pull.ps1`, `sync-models-to-forge.ps1`, `restart-docker.ps1`, and an
`ollama-inspect-before.json` that some earlier session left behind. A wrapper that calls
`docker compose up -d` would not change the determination — compose would still be the owner. A
wrapper that calls `docker run` directly would explain how the unlabelled container came to exist,
and would mean the fix has to land in two places rather than one. Both possibilities are open.

## Step 3 — why Ollama is down, and what that does to the bounded job

The service #997 asks me to reconfigure has not been running since before this lane began.

```
"State": {
  "Status":     "exited",
  "ExitCode":   128,
  "StartedAt":  "2026-08-21T14:02:05.91178028Z",
  "FinishedAt": "2026-08-25T00:48:19.415269743Z",
  "Error": "failed to create task for container: failed to create shim task:
            OCI runtime create failed: runc create failed: unable to start container
            process: error during container init: error running prestart hook #0:
            exit status 1, stdout: , stderr: Auto-detected mode as 'legacy'
            nvidia-container-cli: detection error: nvml error: unknown error"
}
```

`restart: unless-stopped` is set, so Docker has been retrying and failing. The container's own
application log ends at `2026/08/23 - 18:42:15` with a run of `GET /v1/models → 200` from
open-webui's health polling; nothing after the restart reached Ollama's process at all, because the
failure is in the NVIDIA prestart hook, before `/bin/ollama` runs.

**What this is evidence of:** the NVIDIA container runtime cannot initialise NVML for the device set
this container requests, which is *all* GPUs.

**What this is not yet evidence of:** that the P40 is the cause. The correlation is strong — the
container ran for four days and stopped at the boundary where the machine came back with a new card —
but correlation is not the proof #997 asks for, and the test that would settle it is exactly the test
the outage interrupted. The open question, stated so a later lane does not have to rediscover it:

> Docker Desktop on Windows reaches GPUs through the WSL2 backend, which enumerates adapters via
> `dxcore`/`/dev/dxg` — the **WDDM** stack. The P40 is in **TCC**. Whether a TCC-mode device can be
> presented to a WSL2 container at all, and whether its presence breaks enumeration for the WDDM card
> beside it, decides this lane. It is an empirical question with a four-command answer.

The four ephemeral, `--rm`, read-only container probes that answer it were written and staged and
have **not** been run:

1. `--gpus all` → reproduce the failure in isolation from the service.
2. `--gpus '"device=GPU-6d9ae165-…"'` (RTX only) → does the WDDM card alone work?
3. `--gpus '"device=GPU-4f7d4396-…"'` (P40 only) → **the decisive one for the bounded job.**
4. `NVIDIA_VISIBLE_DEVICES=GPU-4f7d4396-…` with the nvidia runtime → the env-var path the live
   container actually used.

All four reuse the already-present `ollama/ollama:latest` image with `--entrypoint nvidia-smi`, so
they prove visibility for the exact runtime image #997 requires be preserved, pull nothing, publish
no port, and cannot disturb the `ollama` container.

## Step 4 — rollback, captured before mutation

Captured through `brokeredExec` (action `rollback-capture`) between `2026-08-25T01:24:56Z` and the
outage — the per-call `startedAt`/`finishedAt` are in the retained invocation records, which the
outage prevented retrieving — written to
`C:\Users\bs\p40-commissioning\evidence\` on HERMES: full `docker inspect` of `ollama`,
`williamos-hermes-inference-proxy` and `open-webui`, plus `docker image inspect ollama/ollama:latest`.

**Container identity**

| | |
| --- | --- |
| name / id | `/ollama` · `9ce2e2d54bda2113a848c0154dab9ec03997c5f7f7e5583c4e06f3d996a6650e` |
| created | `2026-08-18T20:42:32.000630604Z` |
| image | `ollama/ollama:latest` |
| image id | `sha256:9d30908e41144b1f1da89b9d8e33c07e4aeb43ff41a8660241b1686e2cc330ad` |
| repo digest | `ollama/ollama@sha256:9d30908e41144b1f1da89b9d8e33c07e4aeb43ff41a8660241b1686e2cc330ad` |
| image created | `2026-08-16T17:08:24.754620686Z` |
| entrypoint / cmd | `["/bin/ollama"]` · `["serve"]` |
| restart policy | `unless-stopped` |
| network mode | `bridge`; attached to `bridge` **and** `hermes_default` |
| runtime | `runc` |
| binds | `F:/HermesData/ollama:/root/.ollama` (bind, rw, rprivate) |
| ports | `11434/tcp → 11434`, `HostIp: ""` |
| device requests | `[{Count: -1, Capabilities: [["gpu"]], DeviceIDs: null}]` |
| env | `OLLAMA_HOST=0.0.0.0:11434`, `NVIDIA_DRIVER_CAPABILITIES=compute,utility`, `NVIDIA_VISIBLE_DEVICES=all`, `LD_LIBRARY_PATH=/usr/local/nvidia/lib:/usr/local/nvidia/lib64` |
| labels | `{"org.opencontainers.image.version":"24.04"}` |

**Rollback procedure, deterministic.** Because the owning layer is a file and the mutation was to be
a file edit, restoration is `git`-shaped rather than Docker-shaped:

1. restore `C:\HermesLab\hermes\docker-compose.yml` from the retained pre-change copy
   (SHA-256 `2ffc6ccddb650f215a5328a0a2464863bc5ab2bf8ef4067d663d04bc86542c7e`);
2. `docker compose -f C:\HermesLab\hermes\docker-compose.yml up -d ollama` to reconcile back;
3. if the hand-made container must be reproduced exactly instead, the full `docker run` equivalent is
   recoverable field-for-field from `rollback-ollama-inspect.json` (image id, binds, ports, env,
   device requests, restart policy, both network attachments).

The model library is untouched by every step of this: no step copies, moves, deletes or re-pulls
model weights, and the image is referenced by an id that is already present locally so no `latest`
pull is implied.

**Honest limit on this receipt.** The rollback is *captured and complete*; it is **not proven
restorable**, because proving it requires performing the mutation and then undoing it, and the
mutation never happened. #997's acceptance item 5 asks for rollback evidence to exist, and it does.
Any claim stronger than that would be manufactured.

## The model store — the finding that would have blocked the mutation anyway

| source | says the model store is | reality on the machine |
| --- | --- | --- |
| owner expectation (#997 + install-session comment) | `F:\HermesData\ollama` | — |
| live container bind | `F:/HermesData/ollama` | `Test-Path` → **false** |
| owning compose file | `D:/HermesData/ollama` | `Test-Path` → **true**, containing `cache`, `models`, `id_ed25519`, `id_ed25519.pub`, `pull.log` |

`F:\HermesData\ollama` does not exist on HERMES. The container that was running was bind-mounted to a
host path that is not there. The read that would settle the rest of this — whether `F:` exists as a
volume at all, and the manifest list and blob byte-count under `D:\HermesData\ollama\models` — was
issued at the moment HERMES left the network and did not return.

Two readings are open and this lane cannot choose between them on the evidence it has:

- **`F:` is absent** (drive removed, or never existed under that letter), in which case the Ollama
  service has been serving from an empty or Docker-fabricated model store since `2026-08-18`, and the
  "existing model library" #997 requires be preserved lives at `D:\HermesData\ollama` — where the
  owning compose file has been pointing all along.
- **`F:` exists but `HermesData\ollama` under it does not**, which is the same conclusion with a
  different cause.

Either way the consequence for the bounded job is identical and load-bearing: **reconciling the
compose file as written would move the model-store mount from `F:` to `D:`.** That is a mount change
during a GPU-binding change, which #997's fail-closed list covers ("existing model-store mount /
library cannot be preserved"), and it must be decided on an inventory of what is actually under `D:`
— not on the compose file's comment and not on the owner's recollection. The correct move is to
verify the library on `D:`, and only then reconcile; if the library is *not* there, the lane stops.

## Defects and observations, typed

Nothing below was fixed. #997 scopes this lane to the Ollama/P40 binding; typing adjacent defects is
required, fixing them is out of scope.

### `CONT-997-OLLAMA-CONTAINER-NOT-COMPOSE-OWNED` — REAL DEFECT

```
type:              TYPED_DEFECT
affected:          C:\HermesLab\hermes\docker-compose.yml service `ollama` vs live container
blocks:            #997 acceptance invariant "a configuration that works until HERMES next
                   reconciles its service definition is not HERMES_P40_COMMISSIONED"
blocksCommissioning: YES -- it determines WHERE the fix goes, and it is why no docker mutation ran
mustResolveBefore: any P40 binding change to the Ollama service
```

The running `ollama` container carried no `com.docker.compose.*` labels while every other service in
the same project did. It was created by hand on `2026-08-18T20:42:32Z`, squatting the
`container_name: ollama` the compose file claims, and drifted from the owning definition in three
places (model store, port exposure, GPU request). The next `docker compose up -d` in
`C:\HermesLab\hermes` replaces it and silently reverts all three.

### `CONT-997-OLLAMA-LAN-EXPOSURE-VIOLATED-DECLARED-AUTHORITY` — REAL DEFECT

```
type:              TYPED_DEFECT
affected:          live `ollama` container port publish, 2026-08-18T20:42:32Z .. 2026-08-25T00:48:19Z
violates:          registry.seed.json hermes-node authority.deny "direct-ollama-lan-exposure"
                   registry.seed.json hermes-node constraints "ollama-loopback-only"
                   registry.seed.json hermes-node runtimes[ollama].details.exposure "loopback-only"
blocksCommissioning: NO -- but it is repaired as a side effect of restoring compose ownership
currently live:    NO -- the container is exited, so 11434 is not published at all right now
```

`config/execution-fabric/registry.seed.json` declares for `hermes-node` an authority **deny** of
`direct-ollama-lan-exposure` and a **constraint** of `ollama-loopback-only`, with the Ollama runtime's
own `details.exposure: "loopback-only"`. The owning compose file honours it: `127.0.0.1:11434:11434`,
commented as deliberate. The hand-made container published `11434` with `HostIp: ""` — every
interface, LAN included — for the six days it ran. Nothing in the system noticed. The declared
constraint and the running configuration disagreed and no surface reported it, which is the same
class of gap as `CONT-EXPV2-HARDWARE-CHANGE-UNRECORDED` from `#998`: the system holds a truth and a
declaration side by side without comparing them.

### `CONT-997-OLLAMA-MODEL-STORE-PATH-ABSENT` — REAL DEFECT

```
type:              TYPED_DEFECT
affected:          live `ollama` container bind F:/HermesData/ollama -> /root/.ollama
observed:          Test-Path 'F:\HermesData\ollama' == false, between 01:24:56Z and the outage
blocksCommissioning: YES -- model preservation cannot be asserted until the real library is located
mustResolveBefore: reconciling the compose definition, which would mount D: instead
```

The service's model-store bind pointed at a host path that does not exist, while the owning compose
file points at `D:\HermesData\ollama`, which does. The owner's stated expectation agrees with the
container, not with the file. Deciding which holds the model library is a read, not a judgement call,
and it is the first read this lane owes when HERMES returns.

### `CONT-997-OLLAMA-GPU-PRESTART-HOOK-FAILURE` — REAL DEFECT

```
type:              TYPED_DEFECT
affected:          ollama container start, all attempts since 2026-08-25T00:48:19Z
symptom:           ExitCode 128, prestart hook #0 exit 1,
                   "Auto-detected mode as 'legacy' / nvidia-container-cli: detection error:
                    nvml error: unknown error"
blocksCommissioning: YES
cause:             NOT ESTABLISHED. Correlated with the P40's arrival; the decisive test did not run.
```

Successor to `#998`'s `CONT-EXPV2-HERMES-OLLAMA-NOT-OBSERVED`, which recorded the absence without a
cause. The cause is now narrowed to the NVIDIA container prestart hook failing NVML detection for the
requested device set (`all`). Whether the P40 in TCC mode is the reason, and whether binding the P40
alone succeeds or fails, is unresolved.

### `CONT-997-P40-POWER-CAP-NOT-PERSISTED` — OBSERVATION

```
type:              TYPED_OBSERVATION
observed:          enforced.power.limit 250.00 W, default 250.00 W, min 125 W, max 250 W
expected:          150 W temporary commissioning cap
blocksCommissioning: NO -- #997 requires the cap be (re)applied before load, which this lane
                   never reached; recorded so the next attempt does not assume it is in place
```

Persistence mode reads `N/A` for both cards on this Windows host, so a `-pl` setting has nothing
holding it across a driver reload. Whether the cap can be applied at all through an admitted
mechanism depends on elevation, which was not established before the outage.

### `CONT-997-HERMES-OFFLINE-MID-LANE` — BLOCKED_DEPENDENCY

```
type:              BLOCKED_DEPENDENCY
reason:            WAITING_EXTERNAL_ENVIRONMENT
condition:         HERMES_REACHABLE
ownerDecisionRequired: false
automatic:         yes -- resume at the container-isolation test (step 3) and the model-store read
```

HERMES left the network at approximately `2026-08-25T01:35Z`, roughly eleven minutes after the
canonical probe. Verified as a machine-level absence, not an overlay-level one: the Tailscale peer
reports `offline`, ICMP to `100.97.194.84` fails, and no host on the lab LAN (`192.168.88.0/24`,
which OMEN is on at `.11`) answers as HERMES on the fabric key. This is the same typed state
`CONT-EXPV2-P0-RUNTIME-PROOF` carried before `#998` settled it, and it resolves the same way — by the
machine returning, not by anyone being asked to fetch it.

## Disposition

**`HERMES_P40_BLOCKED_RUNTIME`**, provisionally, and the provisionally matters.

`HERMES_P40_COMMISSIONED` is unreachable from here: items 2, 3, 4, 6, 7 and 9 of #997's acceptance
list all require a running Ollama service bound to the P40, and there is no running Ollama service.
Item 1 (live canonical discovery proves the P40 as a new accelerator identity) holds, item 5
(rollback evidence exists) holds, and item 10 (`OWNER_COURIER_ACTIONS = 0`) holds.

`BLOCKED_RUNTIME` is the honest terminal verdict for what was observed — the runtime the lane was sent
to reconfigure is failing to start, for a GPU-related reason, and that is a runtime block rather than
an identity, thermal or service-preservation one. It is provisional only because HERMES left before
the four-command test that would say whether the block is *the P40 cannot be reached through WSL2*
(terminal, and a design question about whether Ollama on HERMES should run in Docker at all) or
*the container is asking for the wrong device set* (repairable in the compose file, in one edit).

`HERMES_P40_BLOCKED_THERMAL` is **not** the verdict and must not be read as one: no thermal or ECC
anomaly was observed. The P40 idles at 29 °C against a 92 °C slowdown threshold with zero volatile ECC
errors, and no load was ever applied.

### What #997 may claim, and may not

**May claim.** The P40 exists, is measured, is in TCC, has 23 040 MiB of `nvidia-smi`-measured VRAM,
32 GiB of BAR1, ECC enabled with a clean volatile counter, an observable 92 °C slowdown threshold, and
is attached to no compute process. The canonical owner of the Ollama service is identified with label
evidence. Rollback is captured. Six owner expectations are verified; two are refuted by observation.

**May not claim.** That the P40 is bound to Ollama — it is not. That models are preserved — their
location is not yet established. That the API contract on 11434 is preserved — nothing is listening.
That the P40 can serve inference — no inference was run, and `capability` stays `UNKNOWN`, which is
the correct state and not a gap. That the 150 W envelope is in place — it is not. That rollback works
— it is captured, not exercised. That the P40 broke Ollama — likely, unproven.

## Resumption plan

Ordered, and each step gated on the previous one, so a later lane does not have to re-derive it:

1. **Model-store read.** Volume table; `F:` existence; manifest list and blob count/bytes under
   `D:\HermesData\ollama\models`. If the library is not on `D:`, stop —
   `HERMES_P40_BLOCKED_SERVICE_PRESERVATION`.
2. **Remaining ownership read.** `start-hermes.ps1`, `run-all.ps1`, `sync-models-to-forge.ps1`,
   scheduled tasks. If any of them runs `docker run` for Ollama directly, the ownership picture
   changes and the fix location changes with it.
3. **Container-isolation test**, the four `--rm` probes above. This is the decision point.
4. If the P40 is reachable in a container: edit **`C:\HermesLab\hermes\docker-compose.yml`** — the
   owning layer — replacing `count: all` with
   `device_ids: ['GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2']`, correcting the model-store path to
   whatever step 1 proved, and leaving the loopback port line as it stands. Then
   `docker compose up -d ollama` and verify the recreated container carries
   `com.docker.compose.project=hermes` — reconciliation durability is proven by the labels being
   there, not by the container running.
5. Prove isolation **from inside** the container: `nvidia-smi -L` shows the P40 and not the 3050;
   `/root/.ollama` holds the library; `/api/tags` lists the models; 11434 answers on loopback.
6. Apply the 150 W cap, confirm it reads back, and only then run bounded inference on a model that is
   already present, aborting at a conservative margin below the observed 92 °C slowdown.
7. The `150 → 200 → 250 W` evaluation only if step 6 is clean, each step gated on the last.

## Retained artifacts

Written on HERMES under `C:\Users\bs\p40-commissioning\evidence\` and **not yet retrieved** — the
outage interrupted the pull. They are named here so the resuming lane collects them rather than
re-running the reads:

`01-nvidia-telemetry-preload.json`, `02-driver-model.json`, `03-docker-state.json`,
`04-rollback-capture.json`, `05-rollback-summary.json`, `06-ownership-compose.json`,
`07-labels-and-modelstore.json`, `rollback-ollama-inspect.json`, `rollback-proxy-inspect.json`,
`rollback-openwebui-inspect.json`, `rollback-ollama-image-inspect.json`,
`.artifacts/execution-fabric/hermes-node.json`,
`.artifacts/execution-fabric/hermes-node.brokered-invocation.json`.

Every one of them is the stdout of a `brokeredExec` call with its command, timestamps and duration
recorded alongside, and every one of those calls appended a line to
`C:\Users\bs\.williamos\fabric\audit.log`.

## Chronology

- `2026-08-25T01:24:13.020Z` — `brokeredExec` invoked, node `hermes`, action `probe`
- `2026-08-25T01:24:13.297Z` — probe's `observed_at`; both accelerators read
- `2026-08-25T01:24:22.046Z` — brokered call returned `rc=0`, 21 021 bytes
- `2026-08-25T01:24:56Z` — supplementary telemetry read (`nvidia-smi -q`), brokered
- `2026-08-25T01:24:56Z .. ~01:35Z` — driver-model read; Docker state read; rollback captured;
  ownership determined by compose labels; model-store discrepancy found
- `2026-08-25T~01:35Z` — HERMES left the network; all subsequent reads failed
