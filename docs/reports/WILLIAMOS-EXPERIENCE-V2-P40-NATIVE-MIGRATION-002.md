# WilliamOS Experience V2 — HERMES P40 Native Migration 002

Status: **`HERMES_P40_COMMISSIONED_WITH_LIMITS`**

Issue: `#997 HERMES_P40_COMMISSIONING` · Checkpoint: PR `#1000` and report
`WILLIAMOS-EXPERIENCE-V2-P40-COMMISSIONING-001.md` (verdict `HERMES_P40_BLOCKED_RUNTIME`) ·
Owner decision: 2026-08-24, *"Native Windows Ollama. Preserve the P40 in TCC mode."*

Every read and every mutation went through `lib/fabric/broker.mjs` on HERMES and was **appended to
the lab's one audit ledger after execution** — 27 entries under this lane's `mig-*` action names, in
a ledger that grew to 19,686 lines. SSH and `scp` carried files and started `node`; they produced no
fact recorded here.

**Not claimed: that the ledger was proven writable before the node was touched.** Mutating steps
passed `--require-audit`, and that flag is **inert against this broker**. `lib/fabric/broker.mjs` at
`b9f5138b…` — the copy staged on HERMES and the copy on this branch — contains no `requireAudit` and
no `requireLedger` at all; grep it. The flag reached the wrapper and was dropped. The independent
review of report 001 established this for that lane's one mutation, and it applies equally to every
mutation here, so it is stated rather than inherited quietly. The appends are real, which is a fact
about the lab's ledger being present and writable, not a guarantee the wrapper delivered. #996 is
where the ordering the flag names becomes true.

`OWNER_COURIER_ACTIONS = 0`.

## Result in one paragraph

**Ollama on HERMES is now one native Windows service, owned by one scheduled task, serving the same
five models from the same store on loopback only, driving the Tesla P40 in TCC mode at a 150 W cap
that it reapplies and verifies on every boot — and it proved all of that by surviving a reboot.** The
owner's acceptance test passed on its own terms: after the reboot exactly one Ollama came back, the
Windows-owned one, and the service log records it finding the P40 at **250 W** and putting it back to
**150 W**, which is the durability the old one-shot `nvidia-smi` never had. Two limits are real and
neither is cosmetic. First, the pinned Ollama is **v0.9.2**, not current, because *every* published
release builds its CUDA-12 runner against **cudart 12.8** and this host's driver is **560.94 /
CUDA 12.6** — v0.32.15 discovered the P40 perfectly, offloaded all 29 layers, and then died at warmup
with *"the provided PTX was compiled with an unsupported toolchain"*; only v0.6.0–v0.9.2 also ship a
**cuda_v11** runner, which loads here and supports Pascal natively. Second, and more importantly,
**the card has no thermal steady state at 150 W in this chassis**: from a 68 °C baseline it reached
the 85 °C abort in about **59 seconds** of continuous work, still climbing ~2–3 °C per iteration,
while decode throughput barely moved (35.21 → 34.80 tok/s). Performance was never the limit; heat
was. So the staged 200 W and 250 W evaluation was **not attempted and is not recommended** — #997 §8
allows it only after 150 W passes a thermal check, and a run that ends on the thermal rule has not
passed one. The constraint is airflow, not the power limit. `SUSTAINED = NOT_ADMITTED`.

**Review then found the one-owner guard, and executing the failure it described found two more.** The
guard matched a process *name*, so an orphaned runner looked exactly like a live server. Underneath
that: the task never noticed its server had died at all — a surviving runner held the output pipe
open and the task sat in state `Running` with nothing listening — and underneath *that*, the
`RestartCount 3` this record cited as automatic recovery does not fire for an action that runs and
returns a failure code, so there were no retries to refuse. All three are fixed, re-installed, and
proven on the commissioned host, including a **113-second unattended recovery** from exactly the
state review described. `MIG-20`, and *Review remediation* below.

## The owner decision this executes

> #997 remedy: Native Windows Ollama. Preserve the P40 in TCC mode. Do not switch it to WDDM merely
> to satisfy the existing Docker/WSL deployment. Supersede the containerized Ollama runtime with one
> canonical Windows service definition only after proving model-store/API compatibility and
> rollback. Keep the RTX 3050's display/utility role unchanged.

Every clause held. The P40 was never taken out of TCC. The RTX 3050's driver model, power policy and
display role were read but never written. Compatibility was proven on a **non-canonical port** before
anything was superseded, so the proof and the supersession could not be the same act.

## Step 1 — compatibility proved before superseding anything

Native Ollama was installed additively under `D:\HermesServices\ollama\` — the convention this
machine already uses for HERMES services (`D:\HermesServices\williamos-hermes-agent`). The path did
not exist beforehand, which is recorded, so the rollback for the install step is exactly
`Remove-Item -Recurse -Force 'D:\HermesServices\ollama'`.

The package was verified against the publisher's own checksum file, not merely by size:

```
published  a1d11d46a944f9c7521f5e9a3a5db51cd3365401da627d96c204698fc6914ff9  ./ollama-windows-amd64.zip
downloaded a1d11d46a944f9c7521f5e9a3a5db51cd3365401da627d96c204698fc6914ff9
CHECKSUM_MATCH=True
```

Pointed at the **existing** store `D:\HermesData\ollama\models` on `127.0.0.1:11435`, v0.32.15
listed all five models and answered both the native and the OpenAI-compatible surface. It also found
the card exactly as the owner's rationale predicted — the thing WSL2 could never do:

```
inference compute  filter_id=GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2  library=CUDA compute=6.1
                   name=CUDA0 description="Tesla P40" libdirs=ollama,cuda_v12 driver=12.6
                   pci_id=0000:02:00.0 type=discrete total="22.4 GiB" available="22.2 GiB"
```

`CUDA_VISIBLE_DEVICES` bound by **UUID** was honoured (`user overrode visible devices`), the model
was scheduled onto the P40, and `load_tensors: offloaded 29/29 layers to GPU`. Then:

```
ggml-cuda.cu:106: CUDA error
CUDA error: the provided PTX was compiled with an unsupported toolchain.
  in function ggml_cuda_kernel_can_use_pdl
llama-server terminated  exit.code=3221226505 (0xc0000409)
```

## Step 2 — the version pin, and why it is the host driver's fault

That failure is **not** about Pascal. The runner advertises
`CUDA : ARCHS = 500,520,600,610,700,750,800,860,890,900,1200` — `610` is the P40's `sm_61`, and
`1200` is Blackwell, which requires a CUDA **12.8+** toolkit to build. Loading the module JITs its
embedded PTX, the PTX ISA is newer than driver 560.94 can accept, and the whole module fails. The
RTX 3050 would fail identically.

So the question was never "which Ollama supports the P40" — they all do — but "which Ollama was built
with a toolkit this driver can load". Reading the CUDA runtime DLL shipped inside each release
answers that directly. Sixteen releases spanning the project's history were probed by **HTTP range
reads of the zip central directory** rather than by downloading them (an earlier attempt that
downloaded whole 2 GB archives died at the 540 s broker timeout after five):

| releases | runner dirs | shipped `cudart` | loads on driver 560.94 (CUDA 12.6)? |
| --- | --- | --- | --- |
| v0.10.0 → v0.32.15 | `cuda_v12`, `cuda_v13`, `vulkan` | **12.8** (`…12080`) | **no** |
| v0.6.0 → **v0.9.2** | **`cuda_v11`**, `cuda_v12` | **11.3** (`…11030`) + 12.8 | **yes, via `cuda_v11`** |
| v0.3.0 → v0.5.0 | `runners`, `rocblas` | 11.3 | yes (but far older) |

`v0.9.2` is therefore the **newest** native Ollama this host can run on the P40. Left alone it would
still prefer `cuda_v12` on a 12.6 driver and die the same way, so the service forces
`OLLAMA_LLM_LIBRARY=cuda_v11`. The service log confirms which backend actually loaded:

```
using requested gpu library  requested=cuda_v11
load_backend: loaded CUDA backend from D:\HermesServices\ollama\v0.9.2\lib\ollama\cuda_v11\ggml-cuda.dll
```

**This pin is lifted by raising the host GPU driver, and that is an owner decision, not a lane one.**
A GPU driver update is a machine-wide change to the adapter that also drives the owner's display,
requires a reboot, and sits outside a decision whose text is *"keep the RTX 3050's display/utility
role unchanged."* It is typed below rather than improvised.

## Step 3 — the model store, and the four blobs that went

Under v0.9.2 the same store served all five models and the full API surface:

```
model=llama3.2:3b                    family=llama params=3.2B  quant=Q4_K_M
model=qwen2.5-coder:7b               family=qwen2 params=7.6B  quant=Q4_K_M
model=qwen3:4b-instruct              family=qwen3 params=4.0B  quant=Q4_K_M
model=snowflake-arctic-embed2:latest family=bert  params=566.70M quant=F16
model=williamos-qwen3-4b:64k         family=qwen3 params=4.0B  quant=Q4_K_M
```

**One thing must be said plainly: the first native start deleted four files from the owner's model
library.** Ollama prunes blobs no manifest references, `OLLAMA_NOPRUNE` defaulted false, and the store
went from 25 blobs / 10,360,082,334 bytes to 21 / 10,360,071,891 — **10,443 bytes across four files**
(`215a3316…` 10,127 B, `7101a4a1…` 250 B, `70636fb8…` 53 B, `b507b9c2…` 13 B, all written
2026-08-17T18:32Z). It was then proved that the loss was confined to genuine orphans, by resolving
every manifest to its blobs:

```
unique_referenced=21   present=21
referenced_but_missing=(none)   present_but_unreferenced=(none)   referenced_bytes=10360071891
```

All five models remain complete. Whatever the merits of that prune, an inference service does not get
to delete from the owner's library as a side effect of starting, so **`OLLAMA_NOPRUNE=1` is set in the
service definition** and the store has been byte-identical since.

## Step 4 — the ownership migration, with rollback receipts

Rollback captured **before** the edit, into `C:\HermesLab\hermes\_997-rollback\`, digests recorded:

| artifact | sha256 |
| --- | --- |
| `docker-compose.yml.bak-997-20260825T030944Z` | `2ffc6ccddb650f215a5328a0a2464863bc5ab2bf8ef4067d663d04bc86542c7e` |
| `start-hermes.ps1.bak-997-20260825T030944Z` | `ab0b6d458d9ecd648e43b5111180539f8ba93aad25021463e3841601acfca0c2` |
| `ollama-container-inspect-20260825T030944Z.json` | `066293a2c3e56f513491f8f4b7ebd4722ec3d0eb131e6e205ad9e44694a1ec29` |
| `ollama-image-inspect-20260825T030944Z.json` | `0b748b0fe605e261bfe22814026a385eaf7610709b52c0d7ec5c18ac909d4424` |

The container image was **not** removed: `ollama/ollama@sha256:9d30908e4114…` is still in the local
image store, so the rollback is real rather than nominal.

What changed, in order, each step rolled back-able on its own:

1. **The canonical service was established and proven on `127.0.0.1:11434` first**, so the
   supersession removed a definition whose replacement was already serving rather than creating a gap.
2. **Only the Ollama portion of compose was removed.** `postgres`, `redis`, `open-webui` and
   `portainer` kept their definitions, volumes and published ports. `docker compose config --services`
   now returns four services and no `ollama`.
3. **The hand-created container was removed.** Created `2026-08-18T20:42:32Z` outside compose with
   `restart: unless-stopped`, it would have been restarted by the Docker daemon at the next boot and
   fought the Windows service for port 11434 — exactly the condition the acceptance test hunts for.
4. **`start-hermes.ps1` no longer pulls.** `docker compose pull` is now behind an opt-in
   `-PullImages` switch, and the script reports the Ollama service's task state and model count
   instead of pretending Ollama is one of its containers.

### open-webui: measured, not assumed

open-webui reached Ollama as `http://ollama:11434` over the compose bridge — a path that dies with the
stanza. Whether a container can reach a listener bound to the **host's** `127.0.0.1` was tested from
inside the running container rather than reasoned about:

```
http://host.docker.internal:11434/api/tags => OK 1727 bytes, model list returned
http://192.168.88.9:11434/api/tags        => FAIL URLError <urlopen error timed out>
http://172.25.208.1:11434/api/tags        => FAIL URLError [Errno 111] Connection refused
```

Docker Desktop proxies `host.docker.internal` (192.168.127.254) through a component running **on the
host**, so it reaches the loopback listener while the LAN address does not. `OLLAMA_BASE_URL` is now
`http://host.docker.internal:11434`, and open-webui lists all five models. **No `extra_hosts:
host.docker.internal:host-gateway` line was added** — on Docker Desktop that name is built in, and
mapping it to `host-gateway` would repoint it at the bridge gateway `172.18.0.1`, which cannot reach
host loopback. The "portable" line would have broken the thing it looks like it protects.

So loopback-only and a working web UI are not in conflict here, and no policy hole was opened to make
them coexist.

## Step 5 — the acceptance test, verbatim outcome

The owner's test, exactly as written: disable/remove only the Ollama portion of compose → restart and
reconcile the stack → **reboot HERMES** → prove exactly one Ollama comes back.

**Result: PASS**, with one row qualified — the reboot-time Docker check could not run, and the note
under the table says exactly what was and was not established unattended.

| check | evidence |
| --- | --- |
| the reboot happened | boot time `2026-08-25T01:40:10Z` → **`03:15:02Z`** |
| exactly one Ollama | `ollama.exe serve` **pid 10788**, parent `powershell.exe` (the service task); `ollama.exe runner --model …` **pid 9736, ppid 10788** — one server and the child it spawned, not two owners |
| owned by the Windows service | task `WilliamOS-HERMES-Ollama` state **Running**, last run `03:15:15Z`, boot trigger |
| no container returned | at reboot: **`DOCKER_ENGINE_UNAVAILABLE`, not an empty list** — `MIG-11b` records `docker ps` failing to reach the API (`npipe:////./pipe/dockerDesktopLinuxEngine … The system cannot find the file specified`). Absence is established separately by `MIG-14`, **after Docker was started by hand**. See the note under this table |
| compose did not recreate it | compose digest unchanged `bbdf7b1c…`; services = `redis, open-webui, portainer, postgres` |
| same models | 5, identical names and digests, from `D:\HermesData\ollama\models` |
| same API contract | `/api/version` `0.9.2`, `/api/tags` 5, `/v1/models` 5 |
| loopback only | listener `127.0.0.1:11434` alone; **all nine** non-loopback interfaces refused, including LAN `192.168.88.9` and Tailscale |
| models intact | 21 blobs / 10,360,071,891 bytes |
| inference still on the P40 | generate OK; P40 3,553 MiB @ 47 %; RTX 3050 49 MiB @ 0 % |

**One row in that table is qualified, and the qualification matters because of the word the test
turns on.** The reboot-time check for "no container returned" could not run: `MIG-11b-acceptance.json`
records

```
containers_named_ollama=failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine;
  check if the path is correct and if the daemon is running: open //./pipe/… The system cannot find the file specified.
```

which is the Docker **engine being absent**, not a container list being empty — and this report finds
elsewhere, on its own evidence, that Docker Desktop's engine needs an interactive logon and so does
not survive an unattended reboot. A query that could not run cannot establish that the removed
container did not come back.

Absence *was* proven, by `MIG-14-final-state.json` — but after Docker was started by hand, which is a
different observation at a different time under different conditions. So the unattended leg of this
acceptance is: **no Ollama container could have been recreated at reboot, because the engine that
would recreate it was not running**; and **no Ollama container exists once the engine is running**,
which is `MIG-14`, attended. Both are true and they are not the same claim. Filed by review as the
same defect class as this branch's own `7c5b9780` — an evidence claim that was loosely worded — and
corrected here rather than defended.

### The power cap durability proof

This is the finding `#1000` could only assert. Persistence mode reads `N/A` on this host, so
`nvidia-smi -pl` has nothing holding it. The reboot cleared the cap, and the service's own startup
path put it back — recorded by the service as it happened:

```
03:15:58Z INFO startup exe=…\v0.9.2\ollama.exe listen=127.0.0.1:11434 gpu=GPU-4f7d…fc2 runner=cuda_v11
03:15:59Z INFO P40 before cap: 250.00 W, 250.00 W, TCC          <-- the reboot DID clear it
03:15:59Z INFO apply cap rc=0 :: Power limit … set to 150.00 W from 250.00 W. All done.
03:15:59Z INFO power cap verified at 150W
03:15:59Z INFO RTX 3050 untouched: … NVIDIA GeForce RTX 3050, WDDM, 70.00 W
```

The cap is applied **and read back**; if it cannot be verified the service **exits without starting
inference**, because an uncapped card running work is the outcome being prevented.

### What the reboot also revealed — and it is not this migration's doing

The **container** half of the stack did not come back. `postgres`, `redis`, `open-webui` and
`portainer` were all down, because the Docker engine never started. The cause was established rather
than assumed, and it exonerates the migration:

- **no interactive logon** after the boot — no `explorer.exe`, no type 2/10/11 logon events;
- Docker Desktop's autostart is **`HKCU:\…\Run :: Docker Desktop`**, a *per-user* key that only fires
  at interactive logon. `com.docker.service` was Running, but both WSL distros were **Stopped**;
- **Tailscale**, which this lane never touched, failed the same way — service Running, `tailscaled`
  alive, interface holding an APIPA address `169.254.83.107`. That is the control case;
- nothing this lane changed is Docker configuration: only the *contents* of `docker-compose.yml` and
  `start-hermes.ps1`; no `daemon.json`, no autostart entries.

The migrated Ollama service, by contrast, came back unattended — because it is a SYSTEM
boot-triggered task rather than a user-session application. The stack was then restored (WSL
`docker-desktop` distro started, Docker Desktop launched, all four services Up), **without** making a
permanent autostart change to the owner's Docker configuration to tidy the report. That is typed
below as work for the owner.

## Step 5b — the inherited gap, closed late, and what it found

The independent review of report 001 typed `CONT-997-SECONDARY-OWNER-CANDIDATES-LISTED-NOT-READ` and
assigned it to this lane, **"BEFORE any reconciliation is written"**. It was not. The reconciliation
above was written first and this was closed afterwards, because the remediation commit carrying the
assignment landed on the branch while the migration was already in flight. Saying so is cheaper than
the alternative, and the ordering matters: had a candidate script turned out to issue a direct
`docker run`, the supersession would have been built on a claim that was not yet true.

All **38** scripts in `C:\HermesLab\hermes\` were then read — not listed — and every line mentioning
`docker run|create|start|compose`, `docker-compose`, `ollama` or `11434` extracted.

**No script creates an Ollama container directly.** Only two files issue `docker run` at all:
`backup-volumes.ps1` (an `alpine` tar sidecar) and `setup-ubuntu.sh` (a comment). So the hand-created
container has no surviving creator in this directory, and "one canonical owner" stands.

But the sweep found something the migration itself had broken, which no amount of reasoning from the
compose file would have surfaced — **four scripts assume Ollama is a container, and two of them run
on a schedule and now lie:**

| script | what it does now | disposition |
| --- | --- | --- |
| `lab-health.ps1` | `docker ps --filter name=ollama` → **"Ollama : DOWN [FAIL]"** forever, flipping OVERALL to fail and appending to `alerts.log` on a timer | **repaired** |
| `hermes-placement-readiness.ps1` | `$ollamaUp = ($running -contains "ollama")` → `local_llm_capability_health = FAIL_CLOSED / OLLAMA_DOWN`, contradicting the service this lane just commissioned | **repaired** |
| `core-online.ps1` | `docker compose up -d postgres redis ollama` → fails, no such service | **typed, not rewritten** |
| `model-pull.ps1` | `docker exec ollama ollama pull` → fails, no such container | **typed, not rewritten** |

The line drawn: **repair what runs unattended and reports a falsehood; type what an operator invokes
and will watch fail loudly.** Both repairs ask the canonical endpoint instead of Docker, are
exact-line replacements verified against the current text before writing (a mismatch aborts rather
than letting a regex guess into a health monitor), and have their own rollback copies in
`_997-rollback`. `hermes-placement-readiness.ps1` keeps its existing model-inventory parser untouched
— the replacement feeds it the same `NAME / ID / SIZE / MODIFIED` shape, built from `/api/tags`.

Verified after repair:

```
local_llm_capability_health=READY  reason=OK   ollama=running   models_inventoried=5
   qwen2.5-coder:7b 4.4 GB fits_gpu=True gpu      williamos-qwen3-4b:64k 2.3 GB fits_gpu=True gpu
   qwen3:4b-instruct 2.3 GB fits_gpu=True gpu     snowflake-arctic-embed2 1.1 GB fits_gpu=True gpu
   llama3.2:3b 1.9 GB fits_gpu=True gpu

lab-health.json: {"overall":"fail","problems":["Hermes F: 0 GB","Backup task","X-sync task",
                                               "Atlas unreachable","Aegis unreachable"]}
```

**`"Ollama down"` is gone from that list.** Note carefully what is *not* claimed: `lab-health` still
reports `fail`. Every remaining problem predates this lane — the `F: 0 GB` check is the same
drive-letter bug as the forge sync, the two task warnings and the ATLAS/AEGIS reachability failures
are its own pre-existing state, and that run happened minutes after a reboot. The Ollama check was
repaired; the monitor was not adopted.

`lab-health.ps1` is mirrored in this repo at `scripts/lab-control/hermes/lab-health.ps1`; the mirror
was updated from the live file and is byte-identical to it (`c4f1a146…`).

## Step 6 — bounded inference and telemetry at 150 W

`qwen2.5-coder:7b` Q4_K_M, 8 iterations × 320 decode tokens, then a soak. Fail-closed at **85 °C**
against a reported **92 °C slowdown / 95 °C shutdown**.

| measure | value |
| --- | --- |
| decode throughput | **35.82 → 35.33 tok/s** across the bench; **35.21 → 34.80** across the soak |
| TTFT, warm | ~26 ms |
| TTFT, cold (includes model load) | 12,274 ms |
| prefill throughput | **UNKNOWN** — see below |
| VRAM | 5,415–8,958 MiB of 23,040; three models resident together = 13,920 MiB |
| power | max **150.00 W** (bench) / 153.89 W (soak transient); mean under load **121.9 W** / **144.1 W** |
| GPU utilisation | max 94 % |
| SM clock | 1,493 MHz peak; **1,379 → 1,278 MHz** under sustained load |
| PCIe | **gen 3 × 16** under load |
| throttle reasons | `0x0`, `0x1` (idle), `0x4` (**SW power cap**) — **no thermal throttle bit at any point** |
| ECC | **unchanged** throughout: volatile 0/0, aggregate SBE 6 / DBE 0 |
| RTX 3050 during inference | 49 MiB, **0 %**, 7.8 W — no compute application, desktop only |
| compute app on the P40 | `D:\HermesServices\ollama\v0.9.2\ollama.exe`, 5,406 MiB |

**Prefill throughput is reported as UNKNOWN on purpose.** Iterations 2–8 show 22,000–25,000 tok/s,
which is a *prompt-cache hit* on an identical repeated prompt, not prefill work. The single
uncontaminated measurement (iteration 1) is 205 tok/s and is contaminated the other way, by model
load. #997 forbids turning unmeasured telemetry into inferred capability, and a 22 k tok/s prefill
claim would be exactly that.

## Step 7 — the thermal finding, and the refusal to escalate

The bench ended at 77 °C **still climbing ~3 °C per iteration**. "Not yet hot" and "will not get hot"
are different claims, so a soak was run to find out which one was true.

```
COOLDOWN begin temp=77 … 78 … 79 … 80 …          <-- rising with NO load, for three minutes
                                                     (a model was still resident: ~60 W, 1303 MHz)
                     … 79 … 77 … 75 … 73 … 71 … 69  <-- only falls once keep-alive expires
COOLDOWN end baseline=68        (never reached the 45 °C target in six minutes)

iter=1 t_start=68 t_end=74   decode_tok_s=35.21
iter=2 t_start=74 t_end=76   decode_tok_s=35.11
iter=3 t_start=76 t_end=79   decode_tok_s=35.01
iter=4 t_start=78 t_end=81   decode_tok_s=34.90   rise_over_window=7C
iter=5 t_start=81 t_end=83   decode_tok_s=34.84   rise_over_window=9C
iter=6 t_start=83 t_end=85   decode_tok_s=34.80   rise_over_window=11C
ABORT thermal 85C >= 85C at iter 7
SOAK END iters=7 final_temp=85 aborted=True plateau=False baseline=68
```

**68 °C to the 85 °C abort in about 59 seconds of continuous work, with no plateau**, while decode
throughput fell 1.2 %. And afterwards, at **0 % utilisation** with a model resident, the card did not
cool — it kept climbing:

```
20:54:37  85 C  59.99 W  0 %  5416 MiB  1303 MHz
20:55:57  86 C  60.47 W  0 %  5416 MiB  1303 MHz
20:57:18  87 C  60.76 W  0 %  5416 MiB  1303 MHz    <-- 5 °C from the 92 °C slowdown, doing nothing
20:57:38  86 C  17.89 W  0 %     9 MiB   544 MHz    <-- keep-alive expired, model unloaded
```

**Therefore no 200 W or 250 W step was attempted, and none is recommended.** #997 §8 permits
evaluating higher caps only after the 150 W configuration passes isolation, preservation, stability
**and thermal** checks; a run that ends on the thermal rule has not passed the thermal check. Raising
the cap by a third would add heat to a card that already cannot shed what 150 W produces. It is worth
being precise about what is and is not wrong here: the hardware never thermally throttled — the only
throttle bit seen was the SW power cap — and 85 °C was *this lane's* conservative abort, not the
card's limit. Nothing is damaged and nothing is at risk of damage; the card protects itself at 92 °C.
What is true is that **sustained inference on this card in this chassis will reach thermal slowdown**,
and that the remedy is airflow, not a power number.

`STEADY_STATE_POWER` recommendation: **remain at 150 W.** Revisit only after chassis airflow over the
P40 is improved, and only with the same staged, fail-closed method.

## What may now be claimed

### The owner's classification, verbatim

`OWNER-DIRECTION-2026-08-24-p40-classification.md` is binding and its vocabulary is the vocabulary
this record uses. It is reproduced here word for word, including the row this record previously had
no counterpart for at all:

```
EXISTS       = PROVEN
HEALTH       = MEASURED, THERMALLY_CONSTRAINED
SERVICE      = COMMISSIONED
CAPABILITY   = MEASURED_FOR_BOUNDED_LOAD
SUSTAINED    = NOT_ADMITTED
POWER_LIMIT  = 150 W MAX
200/250 W    = REFUSED
```

And the owner's guard sentence, which is the reason the block exists:

> **Commissioned must NOT become safe for unlimited sustained workload.**

`SUSTAINED = NOT_ADMITTED` is an **admission rule**, not a mechanism. Nothing in the service stops a
sustained workload from arriving; see *The thermal boundary, stated exactly* below, which says in one
place what does and does not enforce it.

**The named precondition for lifting `SUSTAINED = NOT_ADMITTED`** is the chassis **airflow
qualification**: substantially better forced airflow over the P40's passive heatsink, then a re-bench
by the same staged, fail-closed method that produced `MIG-12` and `MIG-13`. It is not a power number.
`200/250 W = REFUSED` closes that route by owner decision, and no lane may reopen it by re-benching
at a higher cap.

### What this migration moved

| truth | before | after |
| --- | --- | --- |
| `EXISTS` | observed | **`PROVEN`** — unchanged by this migration |
| `HEALTH` | idle-only, qualified | **`MEASURED, THERMALLY_CONSTRAINED`** — 94 % utilisation, no ECC movement, no driver reset, no service failure, and `MIG-13`'s 68 → 85 °C in 59 s with `plateau=False` |
| `SERVICE` | **not met** | **`COMMISSIONED`** — P40 only by UUID, RTX 3050 carries no inference, store and API preserved, loopback only, survives reboot, one owner enforced at the port |
| `CAPABILITY` | `UNKNOWN` | **`MEASURED_FOR_BOUNDED_LOAD`**: `qwen2.5-coder:7b` Q4_K_M at 150 W on Ollama v0.9.2 / `cuda_v11` → **~35 tok/s decode**, ~26 ms warm TTFT. Prefill remains UNKNOWN, and the load it was measured under was bounded and bursty |
| `SUSTAINED` | not claimed, and **not recorded either** | **`NOT_ADMITTED`** — the row this table did not have. Sustained inference on this card in this chassis reaches thermal slowdown; the remedy is airflow |
| `POWER_LIMIT` | drifted to 250 W across a reboot | **`150 W MAX`**, reapplied and read back on every service start, fail closed |
| `200/250 W` | proposed | **`REFUSED`** by the owner. Not a tuning parameter this program may revisit |

The small-model figures seen in passing (`llama3.2:3b` ~58–86 tok/s, `qwen3:4b-instruct` ~79 tok/s)
came from 3–4 token generations and are **indicative only**; they are not a capability claim.

API surface exercised end to end, so "same API contract" is a checked statement rather than an
assumption: `/api/version`, `/api/tags`, `/api/show`, `/api/generate`, `/api/chat`, `/api/embed`,
`/api/embeddings`, `/api/ps`, `/v1/models`, `/v1/completions`, `/v1/chat/completions` (with `usage`),
`/v1/embeddings` (1024 dims). A per-request `num_ctx=32768` on `williamos-qwen3-4b:64k` also
succeeded, at 11.2 GiB of VRAM.

## The service definition

Repo-tracked at `scripts/lab-control/hermes/ollama-service/`, installed to
`C:\HermesLab\hermes\ollama-service\`:

```
scheduled task  WilliamOS-HERMES-Ollama    SYSTEM · RunLevel Highest
                                           triggers: AtStartup, and a TIME trigger repeating PT2M
                                           ExecutionTimeLimit PT0S · MultipleInstances IgnoreNew
                                           RestartCount 3 / 1 min  (kept, but see below: it never fires
                                           for an action that runs and returns a failure code)
startup path    hermes-ollama-service.ps1  sha256 179a917dca12fd498558872e9941581115a498786f24d89835f448454aa1054b
installer       install-hermes-ollama-service.ps1  sha256 7a8ee85bb83cddf3a955d02d7f38885539a38ffd54314d12ebc997de5ec89c38
                                           (-Uninstall is the rollback)
binary          D:\HermesServices\ollama\v0.9.2\ollama.exe   (literal path; nothing resolves "latest")
listen          127.0.0.1:11434
models          D:\HermesData\ollama\models
GPU             CUDA_VISIBLE_DEVICES = GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2   (UUID, never ordinal)
runner          OLLAMA_LLM_LIBRARY = cuda_v11
store safety    OLLAMA_NOPRUNE = 1
power           150 W reapplied and verified every boot; unverifiable cap ⇒ inference does not start
thermal         START guard only: refuses at ≥80 °C or if temperature is unreadable. No runtime guard.
ownership       the PORT, then process-tree classification; orphaned runners are reclaimed, a live
                server is refused, and a runner from a different install is refused rather than killed
```

The digests above are the **remediated** ones and they match the repository byte for byte. The
commissioning run's `e22ac5ae…` is preserved on HERMES as `.bak-20260824_2330-preremediation`; it was
7,939 bytes against the repository's 7,935, because it was materialised from a here-string over the
broker rather than copied. Deploying the repository file closes that four-byte drift as well.

It is a Task Scheduler definition rather than an SCM service because `ollama.exe` is not a service
binary — it never answers the Service Control Manager, so `sc.exe` would report it failed to start and
kill it — and the alternative is installing a third-party service wrapper that is not on this machine.
Task Scheduler is the mechanism HERMES already runs its own work through, it starts at boot with no
interactive logon, and TCC exists precisely so CUDA works in session 0.

Two implementation details cost real time and are worth recording. `$ErrorActionPreference = 'Stop'`
made the first version die instantly: Windows PowerShell 5.1 turns a native command's stderr into a
terminating error, and `ollama serve` writes its whole structured log to stderr — the service log
ended mid-startup and looked like a crash inside Ollama. And `ollama serve` must remain a child in the
task's own process tree, because a detached grandchild would survive a task stop and become the second
owner this migration exists to prevent — it is now started with `Start-Process -NoNewWindow`, which
keeps that property (proven: `Stop-ScheduledTask` leaves **zero** ollama processes) while fixing the
pipe-inheritance defect described under *Review remediation*.

## Review remediation — one thread, three defects, and a recovery that never existed

Three review threads were filed against this record and an independent merge sweep confirmed all
three by execution. The `:66` one-owner thread was the one with a live consequence, and executing the
failure it described on the commissioned host found **three** defects where it named one. The first
two hid the third, and the third is the one that mattered most: the automatic recovery this record
leaned on did not exist.

Full transcript: `MIG-20-one-owner-and-recovery.txt`. Everything below was run on HERMES, on the
commissioned service, against the live scheduled task.

### 1. The guard matched a process NAME, so the wreckage of an owner looked like an owner

Confirmed exactly as filed. `Get-Process -Name 'ollama'` cannot tell `ollama.exe serve` from
`ollama.exe runner`, and this host's own acceptance capture records them as pid 10788 and pid 9736
(ppid 10788). `MIG-09` records three runner children surviving a parent kill here and clearing them
by hand before the first service start.

Reproduced: a model was loaded so a runner existed, then **only** the server was killed. The runner
survived with a dead parent, the listener was gone, and — because a task stop kills the task's tree
and the orphan is no longer in it — it survived `Stop-ScheduledTask` too. That is the state in which
the old guard exited 1 on every start.

Now: **the port is the ownership test**, then `Win32_Process` command line and parentage classify
what is left. A live server refuses. A runner from a *different* install refuses, because killing a
process this service did not start is not reclamation. A runner from this service's own pinned binary
is reclaimed, logged with its pid, ppid and command line, and its survival is re-checked before
inference starts. Proven:

```
2026-08-25T06:36:22.4380929Z WARN  reclaiming orphaned runner pid=12132 ppid=10788 :: …runner --model …
2026-08-25T06:36:26.5237867Z INFO  reclaimed 1 orphaned runner(s); the P40 VRAM they held returns with them
```

and, against a live owner, the refusal is at the port rather than the name:

```
2026-08-25T06:29:49.7143156Z FATAL refusing to start: port 11434 already has a listener (owning pids 10788)
```

### 2. The task stayed `Running` with no server — found by running the scenario, not by reading it

Review predicted three retries that each refused. There were none, and the reason is worse than the
prediction: **the task never stopped.** `& $OllamaExe serve *>> $ServeLog` makes PowerShell read the
child through a pipe; the runner child inherits the write end; a runner that outlives its parent
holds the pipe open. Measured: with the server killed and one runner alive, the task sat in state
`Running` for minutes, no listener, no server, the task's PowerShell still blocked in the read, and
no `ollama serve exited` line ever written.

That is the precise inverse of this file's own claim that "the task state is a truthful health
signal", and it made the guard in (1) unreachable — a guard on a restart that is never attempted
protects nothing.

Now: `Start-Process -NoNewWindow -PassThru` with real file redirection, and `WaitForExit` on the
**process**. A surviving runner can no longer mask a dead server. Measured: the task left `Running`
0.9 s after the kill. The child is still in the task's tree — `Stop-ScheduledTask` leaves **zero**
ollama processes, which is the property the direct invocation was chosen for.

The stdout and stderr streams are now separate files (`Start-Process` cannot send both to one), and
both are rotated at each start rather than appended forever, because `Start-Process` truncates its
redirect targets and losing the previous serve log would have been a silent cost of this fix.

### 3. `exit $null` is `exit 0` — a success report from a service that had stopped

The first version of (2) exited **0**. `Start-Process -PassThru` returns a process object whose
`ExitCode` reads back as `$null` once the process is gone unless its handle has been cached, and
`exit $null` is `exit 0`. Measured: `LastTaskResult: 0` on a task whose inference server had just
died. In the file whose header claims its state is a truthful health signal, that is the
report-success-having-done-nothing shape this program has paid for before.

Now: `$null = $serve.Handle` before waiting, a non-zero floor when the code is still unreadable, and
an explicit rule that **a server which stops at all is an outage** — an `rc=0` exit is reported as 1
rather than passed through, because 0 would tell Task Scheduler the task completed successfully.

### 4. `RestartCount 3` is not a recovery mechanism, and never was

With (2) and (3) fixed the task now fails correctly — `Ready`, `LastTaskResult 0xFFFFFFFF` — and
**nothing retried it.** `RestartCount 3 / RestartInterval PT1M` were registered exactly as this
record describes them, and over four minutes no retry was attempted. Windows applies
restart-on-failure to a task that fails to **run**, not to one whose action ran and returned a failure
code. The `restart_count=3` this record cited as automatic restart, and that review reasoned about as
"three retries that each exit 1", was never going to restart anything.

A repetition attached to the **boot** trigger does not fix it either: registered post-boot with
`PT2M`, the task sat at `Ready` with `LastRunTime` "never" and fired nothing, because a boot
trigger's repetition window opens at boot.

Now: **two triggers** — the boot trigger, and a TIME trigger repeating every two minutes. A firing
while healthy is a genuine no-op (`MultipleInstances = IgnoreNew` drops it without running the
action: same server pid after 150 s, and zero new lifecycle log lines). A firing while the task is
`Ready` starts the script, whose guard reclaims any orphan on the way in.

This is only safe *because* (1) is fixed. Under the old name-only guard a recheck would have found the
orphan, refused, and logged a failure every two minutes forever.

**Unattended recovery, measured end to end**, from the state the review described — task `Ready`,
orphaned runner holding P40 VRAM, no listener, nothing touched by hand:

```
LISTENER BACK unattended after 113s
  reclaimed 1 orphaned runner(s)   ·   power cap verified at 150W   ·   thermal preflight 62C
  ollama serve started pid=15356 as a child of this task (pid 27044)
  task Running · api {"version":"0.9.2"} · models 5
```

and from a clean `Stop-ScheduledTask`, restored unattended in 26 s.

One honest cost, recorded rather than glossed: a no-op firing sets `LastTaskResult` to `0x800710E0`
("instance ignored") while the service is perfectly healthy. `LastTaskResult` is therefore not the
health signal for this task — the task **state** is, and `lab-health.ps1` asks the API rather than
either of them.

### The thermal boundary, stated exactly

The review thread on `:131` was **confirmed on its facts**: `MIG-13` measured 68 → 85 °C in 59 s at
this cap with `plateau=False`, and the abort that stopped that soak lived in the bench harness, never
in the service. The remedy it proposed — "select and validate a sustainable operating cap" — is
closed by owner decision: `200/250 W = REFUSED`, 150 W stands, and sustained admission is routed to
airflow qualification. What the owner did *not* close is the thread's real subject: nothing in the
running system made `SUSTAINED = NOT_ADMITTED` true.

So here is the complete inventory, in one place, of what does and does not protect this card. No
implied safety:

| Enforced | By what | When |
| --- | --- | --- |
| 150 W power cap | `nvidia-smi -pl`, applied **and read back**; unverifiable ⇒ inference does not start | every service start, and it is needed every time — a reboot restores 250 W |
| a start on an already-hot card | **new**: the service refuses at ≥ 80 °C, and refuses outright if the temperature cannot be read | every service start |
| thermal slowdown | the card's own hardware throttle at 92 °C | always, and it is the last line, not a design |

| **NOT enforced** | |
| --- | --- |
| a temperature ceiling during inference | nothing in the service reads temperature after `ollama serve` starts |
| a request duration bound | none |
| an unload or shutdown path under heat | none |
| `SUSTAINED = NOT_ADMITTED` | an **admission rule about what may be sent here**, not a mechanism that stops it arriving |

**Why the runtime cutoff was not built, stated rather than left as an omission.** A fail-closed
runtime thermal guard has to be *verified* before it can be trusted, and verifying one means driving
this card to its abort temperature under sustained load — which is precisely the workload the owner
has NOT ADMITTED. Shipping an unverified process-killer into a commissioned inference service, on the
strength of a soak that may not be run, would be the same class of claim this whole remediation is
about: a mechanism believed to protect something, never once observed doing it. The start guard is
what could be built and proven at idle, and it is described as exactly that, at the check itself and
here.

The precondition for closing the gap is unchanged and named: **the chassis airflow qualification**,
then a re-bench by the same staged fail-closed method. Not a power number, and not a retry.

### `CONT-997-P40-SUSTAINED-NOT-ADMITTED` — TYPED, carried forward

```
type:      BLOCKED_DEPENDENCY
reason:    AIRFLOW_QUALIFICATION_ABSENT
condition: chassis airflow over the P40's passive heatsink is materially improved, then MIG-12 and
           MIG-13 are re-run by the same staged, fail-closed method
holds:     SUSTAINED = NOT_ADMITTED, and the absence of any runtime thermal enforcement in the
           service. Both are the same open item and neither is closed by a power change.
notClosedBy: raising the power limit. 200/250 W = REFUSED by owner decision.
ownerDecisionRequired: false for the qualification work itself; the refusal above is already recorded.
```

## Findings

### From `#1000`, retyped against what this lane proved

| id | was | now |
| --- | --- | --- |
| `CONT-997-TCC-P40-BLOCKS-ALL-WSL2-GPU-PASSTHROUGH` | DEFECT, terminal | **STILL TRUE, no longer terminal.** Not fixed — routed around. No container on this host can obtain any GPU while the P40 is in TCC. Retype: CONSTRAINT. |
| `CONT-997-OLLAMA-CONTAINER-NOT-COMPOSE-OWNED` | DEFECT | **HEALED.** The hand-made container is removed; ownership is one named Windows service and compose no longer claims the name. |
| `CONT-997-OLLAMA-LAN-EXPOSURE-VIOLATED-DECLARED-AUTHORITY` | DEFECT | **HEALED.** `127.0.0.1` only, proven refused on every non-loopback interface, before and after the reboot. |
| `CONT-997-OLLAMA-MODEL-STORE-BIND-POINTS-AT-NONEXISTENT-DRIVE` | DEFECT | **HEALED and explained** — see below. |
| `CONT-997-START-HERMES-PULLS-LATEST` | DEFECT | **HEALED.** Pull is opt-in `-PullImages`. |
| `CONT-997-P40-POWER-CAP-NOT-DURABLE` | OBSERVATION | **HEALED, with the reboot as proof.** |

### The `F:` mystery, closed

`#1000` established that `F:` is not a drive and correctly refused to go further. It now resolves.
`G:\HermesData\ollama` exists — 12 blobs, 7,180,381,648 bytes, 3 models — with directory creation time
**`2026-08-18T20:42:30Z`**, and the hand-created container was created **`2026-08-18T20:42:32Z`**. The
volume now lettered **`G:` (`HERMES_NVME`) was lettered `F:` when that container was made**; today
`\DosDevices\F:` records a Realtek driver-storage CD-ROM. So "`F:\HermesData\ollama`" and
"`G:\HermesData\ollama`" are the same directory seen at two different times, and the container was
serving from a real store all along.

`#1000`'s conclusion still holds — `D:` is the right store — and now it is provable rather than
merely authorised: `D:` is a strict superset (5 models vs 3; 25 blobs vs 12), every `D:` manifest
resolves completely, and the only blob unique to `G:` is a **151-byte config blob** for a
re-creation of `williamos-qwen3-4b:64k` made inside the container on 2026-08-20 (`"os":"linux"`). The
weight layers are byte-identical. **Nothing is lost by preserving `D:`.** `G:` was left untouched and
verified unchanged at the end.

### New

| id | type | statement |
| --- | --- | --- |
| `CONT-997-OLLAMA-CUDA-TOOLKIT-EXCEEDS-HOST-DRIVER` | DEFECT (environmental) | Every published Ollama builds `cuda_v12` against cudart **12.8**; HERMES runs driver **560.94 / CUDA 12.6**. The service is pinned to **v0.9.2** forced to `cuda_v11`. Remedy: raise the host GPU driver — **owner decision**, machine-wide, affects the display adapter. |
| `CONT-997-P40-NO-THERMAL-STEADY-STATE-AT-150W` | DEFECT (thermal) | 68 → 85 °C in ~59 s of sustained load, no plateau; 85 → 87 °C at 0 % utilisation with a model resident. 200 W/250 W evaluation refused, fail-closed. Remedy: chassis airflow over a passively cooled card. |
| `CONT-997-HERMES-CONTAINER-STACK-REQUIRES-INTERACTIVE-LOGON` | DEFECT | Docker Desktop's engine starts from `HKCU:\…\Run`; an unattended reboot leaves `postgres`, `redis`, `open-webui`, `portainer` down. Pre-existing, proven not caused by this lane. The migrated Ollama service is unaffected. |
| `CONT-997-FORGE-MODEL-SYNC-BROKEN-SINCE-DRIVE-RELETTER` | DEFECT | `sync-models-to-forge.ps1` has `$store = "F:\HermesData\ollama"`. Task `HermesModelForgeSync` last result **2147946720**. **The off-box model archive to ATLAS has not been running.** Not fixed here — outside the Ollama runtime ownership scope and ATLAS-side truth unverified — but it is the safety net that matters most during migrations. |
| `CONT-997-TAILSCALE-DOES-NOT-RECONNECT-UNATTENDED` | OBSERVATION | After the reboot the Tailscale interface held APIPA `169.254.83.107`; the `hermes` ssh alias resolves to the Tailscale address and was unusable for ~23 minutes. Work continued over the LAN address. Touches `#858`'s off-site access. |
| `CONT-997-OLLAMA-PRUNED-UNREFERENCED-BLOBS-ON-FIRST-CONTACT` | OBSERVATION | Four orphan blobs, 10,443 bytes, deleted on first native start. All five models remained complete, proven by manifest resolution. `OLLAMA_NOPRUNE=1` set thereafter. |
| `CONT-997-SECOND-MODEL-STORE-ON-G` | OBSERVATION | `G:\HermesData\ollama`, 3 models, 7.18 GiB — the container's old store under its old drive letter. Left untouched; not garbage-collected, because deciding a model store is disposable is not this lane's call. |
| `CONT-997-PINNED-OLLAMA-DEFAULT-CONTEXT-4096` | OBSERVATION | v0.9.2 defaults `OLLAMA_CONTEXT_LENGTH` to 4096, where the superseded container ran a build that defaulted to the model's own length. `williamos-qwen3-4b:64k` therefore gets 4096 unless a request passes `num_ctx`; `num_ctx=32768` was verified working (11.2 GiB VRAM). |
| `CONT-997-P40-HIGH-RESTING-DRAW-WITH-MODEL-RESIDENT` | OBSERVATION | ~60 W and 1,303 MHz held at 0 % utilisation for the keep-alive window; ~17 W / 544 MHz once the model unloads. Interacts with the thermal finding. `OLLAMA_KEEP_ALIVE` was left at its default rather than changed, because that alters service latency semantics the owner did not ask about. |
| `CONT-997-CONTAINER-ERA-SCRIPTS-STRANDED-BY-MIGRATION` | DEFECT (**caused by this lane**) | Four scripts assume Ollama is a container. `lab-health.ps1` and `hermes-placement-readiness.ps1` ran unattended and reported a falsehood — **both repaired here**. `core-online.ps1` (`docker compose up -d … ollama`) and `model-pull.ps1` (`docker exec ollama …`) are operator-invoked, now fail loudly, and are **left unrepaired**: they are first-run bootstrap scripts whose rewrite is scope this packet bounded away. Anyone reviving them should point them at `127.0.0.1:11434` and `D:\HermesServices\ollama\v0.9.2\ollama.exe`. |
| `CONT-997-BACKUP-VOLUMES-ALSO-WRITES-TO-F` | DEFECT | `backup-volumes.ps1` line 16 mounts `F:/lab-backups/hermes-volumes:/backup`, and `lab-health.ps1` checks `Get-Volume F` and reports `0 GB`. Same drive-letter class as the forge sync: the volume backup has been writing into a path on a letter that is now a Realtek driver CD-ROM. Found while closing the secondary-owner gap; **outside this lane's scope and not touched**, but it belongs with `#862`/`#866` lab-backup work rather than nowhere. |
| `CONT-997-REQUIRE-AUDIT-FLAG-INERT` | DEFECT (inherited, confirmed) | `--require-audit` is accepted by the lane wrapper and dropped: `lib/fabric/broker.mjs` at `b9f5138b…` has no `requireAudit`/`requireLedger`. Every mutation here was ledgered **after** execution, not gated before it. Established by the independent review of report 001 and confirmed to apply to this lane. Closed by `#996`. |

## Acceptance against `#997`

| # | condition | verdict |
| --- | --- | --- |
| 1 | canonical discovery proves the P40 | **met** |
| 2 | RTX 3050 available to host, hidden from Ollama inference | **met** — 0 % utilisation, no compute app, driver model and power policy untouched |
| 3 | models present at the existing store | **met**, with the four-orphan prune disclosed above |
| 4 | port 11434 / API contract preserved | **met**, and tightened to loopback-only as the seed declared |
| 5 | rollback evidence exists | **met** — captured with digests before each mutation. Captured, **not exercised**; said plainly |
| 6 | bounded inference succeeds on the P40-only runtime | **met** |
| 7 | telemetry proves a safe initial envelope | **partially met** — safe for bounded/bursty work; **no thermal steady state under sustained load** |
| 8 | 200/250 W testing follows the staged thermal gate | **met by refusal** — the gate did not open |
| 9 | exact changes and rollback recorded | **met** |
| 10 | `OWNER_COURIER_ACTIONS = 0` | **met** |

Condition 7 is why this is `HERMES_P40_COMMISSIONED_WITH_LIMITS` and not `HERMES_P40_COMMISSIONED`.
The service is genuinely commissioned; the envelope is genuinely bounded by cooling, and
`SUSTAINED = NOT_ADMITTED` is the owner's word for that boundary.

Condition 4's "one owner" leg reads **met** on stronger evidence than it did when this table was
written. It then rested on a name-matching guard that could not distinguish an owner from the
wreckage of one, on a task that could not tell its own server had died, and on a restart policy that
never fired. All three are repaired, re-installed on the commissioned host, and demonstrated — a
refusal against a live owner, a reclamation of a real orphan, and a 113-second unattended recovery.
See *Review remediation*.

## What was deliberately not done

- **No GPU driver update.** It would lift the version pin and it is the single highest-value follow-up
  — and it is a machine-wide change to the owner's display adapter requiring a reboot. Typed, not taken.
- **No WDDM switch.** The owner decision forbids it and TCC is why native Windows works at all.
- **No 200 W / 250 W step.** The thermal gate did not open.
- **No runtime thermal cutoff in the service.** A start guard was added and is proven at idle; a
  runtime cutoff was not built, because verifying one requires driving this card to its abort
  temperature under exactly the sustained load the owner has NOT ADMITTED. An unverified
  process-killer in a commissioned inference service is the same class of claim this remediation is
  about. Stated at the check, in the claims table, and in *The thermal boundary, stated exactly*.
- **No permanent Docker autostart change.** The stack was restored for this boot; making Docker
  survive an unattended reboot is a change to a part of the stack this packet said to leave alone.
- **No fix to `sync-models-to-forge.ps1` or `backup-volumes.ps1` by this lane** — and they are no
  longer unfixed. The `#1004` runtime-settlement lane repaired both on its own branch, where the
  ATLAS-side reasoning belongs, and `CONT-997-FORGE-MODEL-SYNC-BROKEN-SINCE-DRIVE-RELETTER` is
  carried there. This lane still did not touch them, which is why the finding below stays as filed.
- **No deletion of `G:\HermesData\ollama`.**
- **No `OLLAMA_KEEP_ALIVE` change**, despite the resting-power finding.
- **No rewrite of `core-online.ps1` / `model-pull.ps1`**, which this lane stranded. They fail loudly
  rather than silently, and both are first-run bootstrap scripts.

## Evidence

36 artifacts under `docs/reports/experience-v2-p40-commissioning/` prefixed `MIG-` — 29 brokered
evidence records plus the raw soak log, the service lifecycle log, both telemetry CSVs, the two
runner scripts, and `MIG-20-one-owner-and-recovery.txt`, the verbatim host transcript of the
one-owner and recovery remediation (every step, both defects found by running it, and the unattended
recovery). The runner scripts are retained as
`MIG-hx-carrier.mjs` (the brokered carrier) and `MIG-zipprobe.mjs` (the ranged zip reader). Neither
carries a UUID, a VRAM figure, a power number, a device model or a port — grep them. The only match
for `P40` in either is the staged wrapper's own filename and the lane's staging directory, which are
this lane's name rather than a claim about hardware. Also retained are the four `RESUME-*`
artifacts from the interrupted resume lane, which established the post-reboot storage truth this
migration built on.

## A note on where this landed

This began as an extension of PR **#1000**, to avoid two pull requests writing
`docs/reports/experience-v2-p40-commissioning/` — the reservation collision the playbook forbids.
**#1000 merged at `2026-08-25T03:01:08Z` while this lane was mid-flight**, which makes that moot: the
directory is in `main` and there is no concurrent holder. So this is a separate pull request branched
off current `main`, and #1000's verdict is superseded by this report rather than left to contradict
it. Report 001 keeps its text and carries a superseded marker in its header.

One thing went wrong in that handover and is recorded rather than quietly fixed: before noticing the
merge, this lane rewrote #1000's title and body to describe work #1000 does not contain. Both were
restored, with a note at the top of that body explaining the overwrite. A merged pull request is part
of the record, and editing one to describe a later lane's work would have made it lie about itself.
