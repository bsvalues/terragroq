# WilliamOS Experience V2 — HERMES P40 Commissioning 001

Status: **`HERMES_P40_BLOCKED_RUNTIME`**

Issue: `#997 HERMES_P40_COMMISSIONING` · Parents `#990` Gate 1 packet, `#985` System Object Graph,
`#964` Intelligence Fabric V1 · Prerequisite settlement `#998` (Gate 1b, live)

Worked from merged `main` `053a33bdb3bb1db57db6d85fff96163b68f11b22`, in an isolated worktree.
Every read and the single mutation went through `lib/fabric/broker.mjs` and appended to
`C:\Users\bs\.williamos\fabric\audit.log`. SSH carried files and started `node`; it produced no fact
recorded here.

`OWNER_COURIER_ACTIONS = 0`.

## Result in one paragraph

**The P40 in TCC mode makes GPU passthrough into WSL2 impossible for *both* cards, and that is why
Ollama has been dead since the card went in.** Inside WSL, NVML enumerates the RTX 3050 successfully,
reaches `0000:02:00.0` — the P40's PCI address — and fails: `Unable to determine the device handle for
gpu 0000:02:00.0: Unknown Error`, `rc=255`. Because `nvidia-container-cli` initialises NVML *before*
it selects devices, that single unenumerable adapter fails the prestart hook for every device set:
`--gpus all`, `--gpus device=<P40-UUID>`, and `--gpus device=<RTX-UUID>` all return the identical
error and exit 125. The bounded objective — make the existing Ollama service use only the P40 —
therefore **cannot be reached by any configuration change to that service**, because no container on
this host can currently obtain any GPU at all. One mutation was made, the one #997 §4 directs: the
P40's power cap was moved from the 250 W it was actually at to **150 W, verified on readback**. The
compose file was **not** touched, because a GPU-binding change that cannot be validated is exactly the
freestyling #997 forbids. Two owner expectations were refuted by observation (the 150 W cap was not in
effect; `F:` does not exist as a drive on this machine), and the model library was located: **9.65 GiB
across 5 models on `D:`, precisely where the owning compose file has been pointing all along.**

## Discipline this lane held to

- **Ownership inspected before Docker.** It changed the plan. The obvious `docker rm && docker run
  --gpus device=…` fix would have been erased by the next `docker compose up -d` — #997's acceptance
  invariant, not a nuisance.
- **Rollback captured before mutation**, and the mutation that ran carries its own recorded prior
  value (`power.default_limit 250.00 W`, still readable on the card).
- **Expectations verified, not trusted.** Ten held; two did not, and both mattered.
- **Fail closed rather than improvise.** Three remedies for the WSL2 block exist. All three are design
  decisions about how local inference runs on HERMES, not implementation choices inside this envelope.
  They are named below and none was taken.
- **Discovery, not declaration.** No seed, registry, pin or inventory was edited. This lane's tooling
  (`P40-brokered.mjs`, `P40-run-canonical-probe.mjs`) contains no device name, UUID, VRAM figure or
  power number — grep it.

## Step 1 — current truth, bound through the canonical brokered path

Canonical `scripts/execution-fabric/probe-windows.ps1`, digest `fe07b7b7…` — byte-identical to merged
`main` `053a33bd` on both ends, and the same bytes `#998` verified — invoked through `brokeredExec`.
All ten canonical files were digest-matched on HERMES before anything ran
(`P40-canonical-file-digests.txt`). Run twice: `01:24:13Z` before the reboot, `01:48:09Z` after.

- brokered invocation: `2026-08-25T01:48:08.847Z` → `01:48:19.624Z`, 10 776 ms, 21 021 bytes,
  `stderr: null`, `rc=0`
- probe's own `observed_at`: `2026-08-25T01:48:09.2160486Z`, `confidence: "observed"`
- node identity: `hermes-node` / `HERMES`, `machine_id_sha256 7d1d7ef856…`

### Both accelerator identities

| | RTX 3050 | Tesla P40 |
| --- | --- | --- |
| uuid | `GPU-6d9ae165-7272-a38c-06b1-7276869e980f` | `GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2` |
| pci bus id | `00000000:01:00.0` | `00000000:02:00.0` |
| vram total | 6 442 450 944 B (6 144 MiB) | 24 159 191 040 B (23 040 MiB) |
| vram source | `nvidia-smi` | `nvidia-smi` |
| driver | `560.94` | `560.94` |
| temperature (01:48Z) | 33 °C | 32 °C |
| utilization | 0 % | 0 % |

Both UUIDs match the owner's expectation exactly. This is the identity `#998` settled; this lane
consumed it and did not re-describe it. #990 still owns discovery.

### Supplementary telemetry the canonical probe does not carry

`probe-windows.ps1` queries eight `nvidia-smi` fields, so PCIe link state, ECC, power envelope, BAR1
and driver model were read separately — also through `brokeredExec`, so ledgered, but **supplementary
evidence, not a canonical registry input.** Nothing here feeds the snapshot.

| Property | RTX 3050 | Tesla P40 |
| --- | --- | --- |
| driver model | WDDM (pending WDDM) | **TCC** (pending TCC) |
| display mode / active | Enabled / Enabled | Disabled / Disabled |
| compute mode | Default | Default |
| pcie link gen cur/max | 3 / 3 | **1 / 3** (idle) |
| pcie link width cur/max | 8 / 16 | **16 / 16** |
| BAR1 total | 256 MiB | **32 768 MiB** |
| power limit enforced → | 70.00 W | **250.00 W → 150.00 W** (this lane) |
| power limit default / min / max | 70 / 20 / 70 W | 250 / 125 / 250 W |
| ECC mode | N/A | **Enabled** (pending Enabled) |
| ECC volatile SBE / DBE | N/A | **0 / 0** |
| ECC aggregate SBE / DBE | N/A | **6 / 0** |
| shutdown / slowdown temp | 97 / 94 °C | **95 / 92 °C** |
| serial · board part | N/A | `0324017002735` · `900-2G610-0000-000` |
| compute apps attached | 23 (dwm, explorer, browsers, Docker Desktop, …) | **none** |

### Owner expectations, checked one at a time

| # | Expectation | Observed | Verdict |
| --- | --- | --- | --- |
| 1 | RTX 3050 `GPU-6d9ae165-…` | identical | **HOLDS** |
| 2 | P40 `GPU-4f7d4396-…` | identical | **HOLDS** |
| 3 | P40 in TCC | `Driver Model: Current TCC` | **HOLDS** — and it is the cause of the block |
| 4 | ~23 040 MiB usable VRAM | 23 040 MiB, `nvidia-smi` measured | **HOLDS** |
| 5 | PCIe x16 | width `16/16` | **HOLDS (width)**; link *gen* reads 1 of 3 at idle — expected ASPM downclock, only meaningful under load, which was never reached. Recorded `UNKNOWN`, not inferred. |
| 6 | BAR1 32 GB / Above-4G functioning | BAR1 total 32 768 MiB | **HOLDS** |
| 7 | idle ≈ 34 °C / 10 W | 29–32 °C / 10.06–10.74 W | **HOLDS** |
| 8 | Docker / WSL virtualization restored | docker 29.7.2 running, WSL 2.6.1.0 running, both distros up | **HOLDS at the daemon level, FAILS at the GPU level** — see step 3 |
| 9 | existing Ollama container exposes all GPUs | `NVIDIA_VISIBLE_DEVICES=all`, `DeviceRequests count -1` | **HOLDS** |
| 10 | API contract `11434:11434` | live container published `11434→11434` on all interfaces | **HOLDS for the live container — and the live container is the drift**; the owning compose file says `127.0.0.1:11434:11434`. See the exposure defect. |
| 11 | **150 W cap already applied** | `enforced.power.limit = 250.00 W` | **DID NOT HOLD** — applied by this lane, verified at 150.00 W |
| 12 | **model store `F:\HermesData\ollama`** | **`F:` is not a drive on this machine** (C, D, E, G) | **DID NOT HOLD** — library found on `D:` |

**On 11.** Persistence mode reads `N/A` for both cards on this Windows host, so a `-pl` setting has
nothing holding it across a driver reload or reboot. The honest claim was *the cap is not in effect*,
not "the owner was wrong" — and the machine rebooted mid-lane at `01:40:10Z`, which is exactly the
event that clears it. The cap is now applied and will not survive the next reboot either; that is
typed below rather than papered over.

**On 12.** `Get-Volume` returns C, D, E, G and a few unlettered partitions. There is no `F:`. The
running container's bind pointed at a drive letter that does not exist on this machine.

## Step 2 — ownership determination (done before touching Docker)

**The canonical owner is `C:\HermesLab\hermes\docker-compose.yml`** (project `hermes`, compose
2.40.3), **and the Ollama container that was running is not the one it describes.**

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
and `open-webui` carries `com.docker.compose.depends_on: "ollama:service_started:false"` — compose
believes it owns that service, and the name it would claim is held by a container it did not create.

### Three drifts between the owning layer and what was running

| | compose file (owner) | live container (observed) | which is right |
| --- | --- | --- | --- |
| model store | `D:/HermesData/ollama` | `F:/HermesData/ollama` | **the compose file** — `F:` is not a drive |
| port publish | `127.0.0.1:11434:11434` | `11434:11434`, `HostIp: ""` → all interfaces | **the compose file** — the seed denies LAN exposure |
| GPU request | `count: all` | `count: -1` + `NVIDIA_VISIBLE_DEVICES=all` | equivalent; both wrong for this lane's goal |

On two of three drifts the owning layer was correct and the hand-made container was wrong. That is
worth stating plainly: reconciling compose would *repair* the model-store mount and the exposure
violation, not endanger them — the opposite of what the container's own configuration suggested.

### Secondary owners

`C:\HermesLab\hermes\start-hermes.ps1` (`ab0b6d45…`) is a wrapper that runs `docker compose pull`
then `docker compose up -d`. It does not create containers directly, so it does not compete for
ownership — **but its `docker compose pull` would re-pull `ollama/ollama:latest` and silently replace
the preserved image identity**, which is the "casual `latest` pull" #997 warns against. Typed below.

Scheduled tasks present: `HermesCrossNodeBackupSync`, `HermesLabHealth`, `HermesModelForgeSync`,
`HermesVolumeBackup` (all `Ready`), `WilliamOS-HERMES-WSL-Keepalive` (`Running`). None is named for
Ollama startup. No Windows service and no host `ollama.exe` process claims the runtime. Compose is
the owner.

## Step 3 — the block, proven

### The service was already dead

```
container `ollama`: exited, ExitCode 128
StartedAt  2026-08-21T14:02:05.911Z
FinishedAt 2026-08-25T00:48:19.415Z
Error: ... error running prestart hook #0: exit status 1, stdout: , stderr:
       Auto-detected mode as 'legacy'
       nvidia-container-cli: detection error: nvml error: unknown error
```

`restart: unless-stopped` has been retrying and failing since. Its application log ends
`2026/08/23 - 18:42:15` on a run of `GET /v1/models → 200` from open-webui's health polling; nothing
after the restart reached `/bin/ollama`, because the failure is in the NVIDIA prestart hook. This is
the successor to `#998`'s `CONT-EXPV2-HERMES-OLLAMA-NOT-OBSERVED`. It survived the `01:40:10Z` reboot
unchanged.

### The failure is not P40-specific, which is the surprising part

Four ephemeral `--rm` probes, each reusing the already-present `ollama/ollama:latest` image with
`--entrypoint nvidia-smi -L`, publishing no port and mounting nothing:

| test | device selector | exit | result |
| --- | --- | --- | --- |
| T1 | `--gpus all` | **125** | prestart hook, `nvml error: unknown error` |
| T2 | `--gpus device=GPU-6d9ae165-…` (**RTX only**) | **125** | *identical error* |
| T3 | `--gpus device=GPU-4f7d4396-…` (**P40 only**) | **125** | *identical error* |
| T4 | `--gpus all -e NVIDIA_VISIBLE_DEVICES=<P40>` | **125** | *identical error* |

The `nvidia` runtime is correctly registered (`docker info` → `"nvidia": {"path":
"nvidia-container-runtime"}`). Asking for **only the WDDM card** fails exactly as hard as asking for
the TCC one. So the block is not "the P40 cannot be passed through" — it is that *nothing* can.

### Why: NVML dies on the P40 while enumerating, before any device is selected

Run inside the `Ubuntu` WSL2 distro, outside Docker entirely:

```
$ /usr/lib/wsl/lib/nvidia-smi -L
GPU 0: NVIDIA GeForce RTX 3050 (UUID: GPU-6d9ae165-7272-a38c-06b1-7276869e980f)
Unable to determine the device handle for gpu 0000:02:00.0: Unknown Error
rc=255
```

`0000:02:00.0` is the P40. NVML lists the 3050, reaches the P40, cannot get a device handle, and
**aborts the whole call**. The kernel log names the layer underneath:

```
[0.349338] hv_vmbus: registering driver dxgkrnl
[7.696652] misc dxg: dxgk: dxgkio_is_feature_enabled: Ioctl failed: -22
[7.713541] misc dxg: dxgk: dxgkio_query_adapter_info: Ioctl failed: -22
[7.715537] misc dxg: dxgk: dxgkio_query_adapter_info: Ioctl failed: -2
```

`-22` is `-EINVAL`, `-2` is `-ENOENT`. `/dev/dxg` exists and `/usr/lib/wsl/lib` carries the full
driver set (`libcuda.so.1`, `libnvidia-ml.so.1`, `libdxcore.so`, `nvidia-smi`), so the WSL GPU stack
is installed and running — it is *adapter enumeration* that fails.

That is the mechanism, and it closes the question this lane was sent to answer:

> WSL2 reaches GPUs through `dxgkrnl`/`dxcore` — the **WDDM** stack. A **TCC** device has no WDDM
> presence, so `dxgkio_query_adapter_info` fails for it. NVML in WSL enumerates every adapter `dxcore`
> reports before it will answer any query, so one unenumerable adapter fails the whole initialisation.
> `nvidia-container-cli` calls exactly that initialisation in its prestart hook, before it applies
> `NVIDIA_VISIBLE_DEVICES`. Hence: **while the P40 is in TCC, no container on this host gets any
> GPU — not the P40, and not the RTX 3050 either.**

Host-side `nvidia-smi` talks to both cards perfectly throughout, including reading and setting the
P40's power limit. The card is not broken. The **container path** is blocked.

### What this does to the bounded objective

#997 asks me to make the existing Ollama service use only the verified P40, preserving models, the
API surface and the mount. **No configuration of that service can achieve it**, because the failure
happens in the runtime hook before any service configuration is consulted. Editing
`device_ids` in the compose file would produce a container that fails to start with the same error.

Three remedies exist. **None is inside this lane's envelope, and none was taken:**

1. **Switch the P40 to WDDM** (`nvidia-smi -g 1 -dm 0`). It would very likely restore WSL enumeration.
   It also contradicts the owner's own verified expectation that the P40 is in TCC, changes the card's
   fundamental driver-model role, makes a headless compute card a display-capable adapter, and costs
   TCC's lower overhead and full-VRAM addressing. That is a hardware-role decision, not an Ollama
   configuration change.
2. **Run Ollama natively on Windows**, where TCC works and the P40 is fully visible. This abandons the
   container service contract and creates a second Ollama runtime owner — which §3 of #997 explicitly
   says to avoid.
3. **Keep Docker inference on the RTX 3050 only, with the P40 physically or logically removed from
   the WSL adapter set.** There is no `nvidia-container-cli` knob for this; its NVML init is
   all-or-nothing. It would mean not using the P40, which is the opposite of the outcome.

Each trades away something the owner asked for. #997's instruction for the analogous case — *"keep the
card at the safer observed state and type the limitation; do not improvise around it"* — is the rule
this lane followed.

## Step 4 — rollback, captured before mutation

Captured through `brokeredExec` (action `rollback-capture`) before anything was changed: full
`docker inspect` of `ollama`, `williamos-hermes-inference-proxy` and `open-webui`, plus
`docker image inspect ollama/ollama:latest`.

| | |
| --- | --- |
| name / id | `/ollama` · `9ce2e2d54bda2113a848c0154dab9ec03997c5f7f7e5583c4e06f3d996a6650e` |
| created | `2026-08-18T20:42:32.000630604Z` |
| image · id | `ollama/ollama:latest` · `sha256:9d30908e41144b1f1da89b9d8e33c07e4aeb43ff41a8660241b1686e2cc330ad` |
| repo digest | `ollama/ollama@sha256:9d30908e4114…` (image created `2026-08-16T17:08:24Z`) |
| entrypoint · cmd | `["/bin/ollama"]` · `["serve"]` |
| restart policy | `unless-stopped` |
| networks | `bridge` **and** `hermes_default` |
| binds | `F:/HermesData/ollama:/root/.ollama` (bind, rw, rprivate) |
| ports | `11434/tcp → 11434`, `HostIp: ""` |
| device requests | `[{Count: -1, Capabilities: [["gpu"]], DeviceIDs: null}]` |
| env | `OLLAMA_HOST=0.0.0.0:11434`, `NVIDIA_DRIVER_CAPABILITIES=compute,utility`, `NVIDIA_VISIBLE_DEVICES=all`, `LD_LIBRARY_PATH=/usr/local/nvidia/lib:/usr/local/nvidia/lib64` |
| labels | `{"org.opencontainers.image.version":"24.04"}` |

Owning file, pre-change: `C:\HermesLab\hermes\docker-compose.yml`, SHA-256
`2ffc6ccddb650f215a5328a0a2464863bc5ab2bf8ef4067d663d04bc86542c7e`. **It was read and never written.**

**Honest limit.** No container or compose mutation was performed, so this receipt is *captured and
complete*, **not proven restorable** — proving that requires mutating and undoing, which did not
happen. #997 acceptance item 5 asks that rollback evidence exist. It does. Anything stronger would be
manufactured.

**The one mutation that did run carries its own rollback**, and it is a single reversible number:

```
before:  power.limit 250.00 W · enforced 250.00 W · default 250.00 W · min 125 W · max 250 W
action:  nvidia-smi -i GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2 -pl 150     (exit 0)
         "Power limit for GPU 00000000:02:00.0 was set to 150.00 W from 250.00 W."
after:   power.limit 150.00 W · enforced 150.00 W · default 250.00 W · 32 °C · 10.64 W
         ECC volatile 0 / 0
restore: nvidia-smi -i GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2 -pl 250     (or reboot)
```

Bound by UUID, never by ordinal. Ledgered as `hermes power-cap rc=0` with `requireAudit`, so the
ledger was proven writable *before* the card was touched. The RTX 3050 was verified untouched
immediately after: `70.00 W`, `WDDM`, `display_active Enabled`.

## The model store, settled

| source | says | reality |
| --- | --- | --- |
| owner expectation (#997 + install-session comment) | `F:\HermesData\ollama` | **`F:` is not a drive on this machine** |
| live container bind | `F:/HermesData/ollama` | same — a bind to a nonexistent drive letter |
| **owning compose file** | `D:/HermesData/ollama` | **exists, and holds the library** |

`D:\HermesData\ollama\models` — **25 blobs, 10 360 082 334 bytes (9.65 GiB)**, 5 manifests:

- `registry.ollama.ai/library/llama3.2:3b`
- `registry.ollama.ai/library/qwen2.5-coder:7b`
- `registry.ollama.ai/library/qwen3:4b-instruct`
- `registry.ollama.ai/library/snowflake-arctic-embed2:latest`
- `registry.ollama.ai/library/williamos-qwen3-4b:64k`

So the concern that reconciling compose would move the mount and lose the library **inverts**:
reconciling would move it *onto* the library. The last-working Ollama container was bound to a
nonexistent path, which is consistent with its logs — `GET /v1/models` returning `200` says the API
answered, not that it had anything to list.

### Was `F:` a disk that got unseated during the install?

Worth excluding, because if `F:` were a real drive knocked loose while the P40 went in, the owner's
expectation would have been historically correct and a *different* model store would be missing. The
physical layer says no disk is missing:

| disk | serial | bus | status | letters |
| --- | --- | --- | --- | --- |
| WD SN550E 1 TB | `E823_8FA6_…_BDC0` | NVMe | **Online / Healthy** | `G` |
| Samsung SSD 840 120 GB | `S19HNEBD342394X` | SATA | **Online / Healthy** | `E`, **`D`** |
| Samsung SSD 860 EVO 500 GB | `S598NJ0N385161P` | SATA | **Online / Healthy** | `C` + recovery/system |

All three are online and healthy, none is offline, and every partition is accounted for — there is no
unallocated space and no unlettered data partition waiting for a letter. `\DosDevices\F:` *is*
recorded in `HKLM:\SYSTEM\MountedDevices`, but so are `H:`, `I:` and `J:`, none of which is present
either; that registry accumulates every letter the install has ever assigned, including to removable
media, so it is a record of history rather than evidence of a lost fixed disk.

The honest limit: this proves **no disk is currently missing, offline or unhealthy**. It does not
prove `F:` never held anything. What it does rule out is the reading in which a bumped SSD is hiding
the real model library — every disk this machine has is present, and the only large data partition
besides `C:` and the nearly-empty `G:` is the `D:` that holds the models.

`D:` has 62.3 GB free of 119.9 GB. The models are on disk and this lane did not touch them: no step
copied, moved, deleted or re-pulled a weight, and no `latest` pull was issued.

## Defects and observations, typed

Nothing below was fixed. #997 scopes this lane to the Ollama/P40 binding.

### `CONT-997-TCC-P40-BLOCKS-ALL-WSL2-GPU-PASSTHROUGH` — REAL DEFECT, terminal for this lane

```
type:                TYPED_DEFECT
affected:            every Docker container on HERMES requesting any GPU
symptom:             prestart hook exit 1, "nvidia-container-cli: detection error:
                     nvml error: unknown error"; docker run exit 125 for --gpus all,
                     --gpus device=<P40>, AND --gpus device=<RTX>
proven cause:        WSL2 NVML aborts enumeration at 0000:02:00.0 (the P40) --
                     "Unable to determine the device handle ... Unknown Error", rc=255 --
                     because a TCC device has no WDDM/dxgkrnl presence. dxgkio_query_adapter_info
                     fails -EINVAL/-ENOENT in the WSL kernel log.
blocksCommissioning: YES -- terminally, for the containerised approach
collateral:          the RTX 3050 is ALSO unusable from any container while this holds
remedies:            all three change something the owner asked for; see step 3. Not taken.
```

### `CONT-997-OLLAMA-CONTAINER-NOT-COMPOSE-OWNED` — REAL DEFECT

```
type:                TYPED_DEFECT
affected:            C:\HermesLab\hermes\docker-compose.yml service `ollama` vs the live container
blocks:              #997's invariant that a fix surviving only until the next reconcile is not
                     HERMES_P40_COMMISSIONED
blocksCommissioning: YES -- it decides WHERE the fix goes, and it is why no docker mutation ran
```

The running `ollama` container carried no `com.docker.compose.*` labels while every other service in
the same project did. Created by hand `2026-08-18T20:42:32Z`, squatting `container_name: ollama`, and
drifted in three places — **on two of which the owning file was the correct one.**

### `CONT-997-OLLAMA-LAN-EXPOSURE-VIOLATED-DECLARED-AUTHORITY` — REAL DEFECT

```
type:                TYPED_DEFECT
window:              2026-08-18T20:42:32Z .. 2026-08-25T00:48:19Z (six days)
violates:            registry.seed.json hermes-node authority.deny "direct-ollama-lan-exposure"
                     registry.seed.json hermes-node constraints "ollama-loopback-only"
                     registry.seed.json hermes-node runtimes[ollama].details.exposure "loopback-only"
blocksCommissioning: NO -- and it is repaired as a side effect of restoring compose ownership
currently live:      NO -- the container is exited, so 11434 is not published at all
```

`config/execution-fabric/registry.seed.json` declares for `hermes-node` an authority **deny** of
`direct-ollama-lan-exposure` and a **constraint** of `ollama-loopback-only`. The owning compose file
honours it and says so in a comment. The hand-made container published `11434` with `HostIp: ""` —
every interface, LAN included — for six days, and nothing in the system noticed. Same class of gap as
`#998`'s `CONT-EXPV2-HARDWARE-CHANGE-UNRECORDED`: a declaration and a truth side by side, uncompared.

### `CONT-997-OLLAMA-MODEL-STORE-BIND-POINTS-AT-NONEXISTENT-DRIVE` — REAL DEFECT

```
type:                TYPED_DEFECT
affected:            live `ollama` container bind F:/HermesData/ollama -> /root/.ollama
observed:            Get-Volume returns C, D, E, G -- there is no F: on this machine
consequence:         the last-working Ollama served from a store that was not the model library
blocksCommissioning: NO longer -- resolved: the library is on D:, where compose already points
```

### `CONT-997-START-HERMES-PULLS-LATEST` — REAL DEFECT

```
type:                TYPED_DEFECT
affected:            C:\HermesLab\hermes\start-hermes.ps1 (ab0b6d45...)
symptom:             runs `docker compose pull` before `docker compose up -d`, so any use of the
                     documented start path silently replaces ollama/ollama:latest
conflicts with:      #997 "preserve the existing container image/runtime identity rather than
                     blindly pulling latest"
blocksCommissioning: NO -- but it means image identity is preserved only by NOT using the
                     documented start path, which is a trap rather than a guarantee
suggested fix:       pin the digest in the compose file, or drop the pull from the wrapper.
                     Not applied -- changing update policy is the owner's call, not this lane's.
```

### `CONT-997-P40-POWER-CAP-NOT-DURABLE` — OBSERVATION

```
type:                TYPED_OBSERVATION
applied:             150.00 W, verified on readback at 2026-08-25T01:48Z
durability:          NONE across reboot. Persistence mode reads N/A for both cards on this
                     Windows host, so nothing holds a -pl setting. The 01:40:10Z reboot is
                     precisely what cleared the owner's earlier 150 W cap.
blocksCommissioning: NO
suggested fix:       a boot-time reapply through an existing governed mechanism (the host already
                     runs four Hermes scheduled tasks). Not created -- a new scheduled task is a
                     new service owner, and this lane does not mint those.
```

## Acceptance, item by item

| # | #997 requirement | State |
| --- | --- | --- |
| 1 | live canonical discovery proves the P40 as a new accelerator identity | **HOLDS** |
| 2 | RTX 3050 available to host, hidden from Ollama inference | **available to host** (WDDM, display active, 23 compute apps); *hidden from Ollama* is vacuously true and worthless — nothing is running, and the 3050 is unusable from any container anyway |
| 3 | existing models present at the existing model-store mount | **models present** (9.65 GiB, 5 models, `D:`); **not mounted** — no container is running |
| 4 | port 11434 / HERMES API contract preserved | **NOT MET** — nothing is listening |
| 5 | rollback evidence exists | **HOLDS** — captured, not exercised |
| 6 | bounded inference succeeds on the P40-only runtime | **NOT MET** — impossible while the block holds |
| 7 | telemetry proves a safe initial envelope | **PARTIAL** — idle telemetry, thermal thresholds, ECC and a verified 150 W cap; no load telemetry |
| 8 | any 200/250 W testing follows the staged thermal gate | **N/A** — not attempted; step 6 never passed |
| 9 | exact config/service/image changes and rollback recorded | **HOLDS** — one change, recorded with its restore command |
| 10 | owner courier actions remain zero | **HOLDS** |

### The truth model, kept separate

- `EXISTS` — **OBSERVED.** Canonical brokered probe, twice, both UUIDs, measured VRAM.
- `HEALTHY` — **MEASURED, idle only.** 32 °C against a 92 °C slowdown, 10.64 W against a 150 W cap,
  ECC enabled with volatile `0/0` and aggregate `6/0`. No load was ever applied, so this is a healthy
  *idle*, not a healthy *card under work*.
- `SERVICE_BOUND` — **NO.** The service does not run and cannot be bound.
- `CAPABILITY` — **UNKNOWN**, and it must stay there. No inference ran. 23 040 MiB of VRAM is a
  measurement of memory, not a promise that anything fits or that Pascal serves it at a useful rate.
- `STEADY_STATE_POWER` — **NO RECOMMENDATION.** The 150/200/250 W comparison requires load. Producing
  a recommendation from an idle card would be exactly the inference-from-nothing #997 forbids.

## Verdict

**`HERMES_P40_BLOCKED_RUNTIME`.**

Not `BLOCKED_IDENTITY`: identity is clean, and matches the owner's expectation exactly.
Not `BLOCKED_THERMAL`: no load was applied, no thermal or ECC anomaly was observed, and the card
idles 60 °C below its slowdown threshold.
Not `BLOCKED_SERVICE_PRESERVATION`: the models are intact on `D:` and nothing this lane did touched
them; the service is unpreservable only because it cannot start.
Not `COMMISSIONED_WITH_LIMITS`: that verdict implies the P40 is serving inference under a constrained
envelope. It is serving nothing.

The runtime the lane was sent to reconfigure cannot start, for a GPU-passthrough reason that is now
proven rather than suspected, and the fix is a decision above this lane.

## What the P40 may and may not be claimed to be

**May.** Present, measured, TCC, 23 040 MiB, BAR1 32 GiB, x16 width, ECC enabled and volatile-clean,
thermally observable, capped at a verified 150 W, attached to no compute process, and **fully usable
from the Windows host** — `nvidia-smi` reads and writes it without difficulty throughout.

**May not.** Bound to Ollama. Reachable from any container on this host. Proven to run a model.
Assigned a capability, a throughput, a context length or a steady-state power recommendation.
Assumed to have a durable 150 W cap — it does not survive a reboot.

## The state HERMES was left in

Verified at `2026-08-25T01:52Z`, after everything above:

| | |
| --- | --- |
| container list | **identical to what was found** — the four `--rm` probes left nothing behind |
| `ollama` | `Exited (128)` — as found; not started, not removed, not recreated |
| `open-webui`, `portainer`, `postgres`, `redis` | up and healthy, untouched |
| RTX 3050 | `WDDM`, `display_active Enabled`, `70.00 W` — **untouched** |
| Tesla P40 | `TCC`, `enforced 150.00 W`, `default 250.00 W`, 32 °C, 9.77 W |
| `C:\HermesLab\hermes\docker-compose.yml` | SHA-256 `2ffc6ccd…` — **byte-identical to before**, proven not written |
| model library | 25 blobs, **10 360 082 334 bytes** — byte-identical to before |

**ECC did not move.** Re-read like-for-like against the `01:24Z` baseline with the same `-q -d ECC`
query: volatile single/double bit `0 / 0`, aggregate single bit `6`, aggregate double bit `0`. Same
as before the reboot and before the power-cap change. (A combined multi-field `--query-gpu` read
during the final sweep appeared to show aggregate `0`; the like-for-like recheck is the authoritative
one and is retained as `P40-18-ecc-recheck.json`. No counter was reset and nothing grew.)

The machine is left **safer than it was found** — the P40 is capped at 150 W rather than 250 W — and
otherwise exactly as it was found.

## Resumption plan

The decision in step 3 comes first; everything else is downstream of it and none of it is this lane's
to make.

1. **Owner/HERMES decision** on which remedy to take: P40 → WDDM, native-Windows Ollama, or accept
   no-GPU containers. Each trades away something #997 asked for; the trade-offs are in step 3.
2. If **WDDM**: re-run the four `--rm` probes. If they pass, edit
   **`C:\HermesLab\hermes\docker-compose.yml`** — the owning layer — replacing `count: all` with
   `device_ids: ['GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2']`, leaving the `D:` mount and the
   loopback port line as they stand (both already correct). Then `docker compose up -d ollama`
   **without** `start-hermes.ps1`, so no `latest` pull occurs, and verify the recreated container
   carries `com.docker.compose.project=hermes` — reconciliation durability is proven by the labels
   being there, not by the container running.
3. Prove isolation **from inside** the container: `nvidia-smi -L` shows the P40 and not the 3050;
   `/root/.ollama` holds the five models; `/api/tags` lists them; 11434 answers on loopback only.
4. Reapply and verify the 150 W cap (it will have been cleared by any reboot), then bounded inference
   on a model already present — `llama3.2:3b` is the smallest — aborting at a conservative margin
   below the observed 92 °C slowdown.
5. The `150 → 200 → 250 W` evaluation only if step 4 is clean, each step gated on the last.

## Reproduction

```powershell
# on HERMES, from a directory holding the ten digest-verified canonical files
node P40-run-canonical-probe.mjs hermes hermes-node
node P40-brokered.mjs hermes probe <base64-command> evidence/NN.json [--require-audit]
```

Every read and the single mutation are replayable from the retained invocation records: each carries
its exact command, `startedAt`, `finishedAt`, `durationMs` and full stdout.

## Retained artifacts

All under `docs/reports/experience-v2-p40-commissioning/`.

| File | What it holds |
| --- | --- |
| `P40-hermes-node-probe.json` | canonical probe output, `observed_at 01:48:09.216Z` |
| `P40-brokered-invocation.json` | the brokered call that produced it |
| `P40-canonical-file-digests.txt` | ten-file digest match, both ends, vs `053a33bd` |
| `P40-01-nvidia-telemetry-preload.json` | PCIe, ECC, power, BAR1, thermal thresholds, compute apps |
| `P40-02-driver-model.json` | TCC/WDDM, serial, board part number |
| `P40-04/05-rollback-*.json` | full container + image inspect, and the summarised receipt |
| `P40-rollback-ollama-inspect.json` · `P40-rollback-ollama-image-inspect.json` | raw, retained whole |
| `P40-06/07-ownership-*.json` | the compose file, and the per-container label evidence |
| `P40-08-modelstore-truth.json` | volume table, `F:` absence, `D:` manifests and blob bytes |
| `P40-09-post-reboot-state.json` | state after the `01:40:10Z` reboot |
| `P40-10/11-container-isolation-*.json` | the four device-selector tests, with stderr |
| `P40-12/13/14-wsl-*.json` | WSL version, `/dev/dxg`, driver libs, `dxgkrnl` log, **the NVML failure** |
| `P40-15-power-cap-150w.json` | before / apply / verify / RTX-untouched |
| `P40-16-ledger-excerpt.json` | the audit ledger tail, 19 649 lines |
| `P40-17-final-state.json` | the state HERMES was left in |
| `P40-18-ecc-recheck.json` | ECC re-read like-for-like against the baseline |
| `P40-19-physical-disks.json` | all three disks online and healthy; the `F:` letter history |
| `P40-brokered.mjs` · `P40-run-canonical-probe.mjs` | the only two things this lane ran; neither names a device |

## Chronology

- `2026-08-25T01:24:13.020Z` — first canonical brokered probe, `rc=0`, 21 021 bytes
- `01:24:56Z` — supplementary telemetry: TCC, BAR1, ECC, 250 W cap observed
- `01:2xZ` — Docker state; rollback captured; ownership determined by compose labels
- `~01:35Z` — HERMES left the network mid-lane
- `01:40:10Z` — HERMES rebooted (`LastBootUpTime`); the reboot is what cleared the earlier power cap
- `01:44:02Z` — SSH reachable again; lane resumed at the model-store read
- `01:45Z` — `F:` proven absent; 9.65 GiB / 5 models found on `D:`; `IsAdmin=True`
- `01:46Z` — four container isolation tests, all exit 125, including RTX-only
- `01:47Z` — WSL NVML failure isolated to `0000:02:00.0`; `dxgkrnl` ioctl failures read
- `01:48:02Z` — 150 W cap applied and verified; RTX 3050 confirmed untouched
- `01:48:09Z` — final canonical brokered probe, `rc=0`
- `01:48:19Z` — ledger at 19 649 lines, every action recorded, one of them a mutation
