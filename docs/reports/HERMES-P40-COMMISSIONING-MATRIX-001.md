# HERMES P40 commissioning matrix — 2026-08-25

Measured on HERMES after the inference-proxy upstream repair (this PR), against the native Ollama
service on the Windows host. Instrument: streaming `/api/chat` with Ollama's own timing counters
(`prompt_eval_*`, `eval_*`), GPU sampled every 0.5 s with `nvidia-smi`, host CPU busy fraction via
`GetSystemTimes`. Model `williamos-qwen3-4b:64k` (Qwen3 4B, Q4_K_M), `num_predict: 200`,
`temperature: 0.2`, P40 power cap **150 W**. Each run uses a unique prompt so nothing is served
from a prompt cache. Raw: `D:\HermesServices\_bench\matrix.json`.

**The context column is context actually FILLED, not the window configured.** 8K/32K/64K runs
ingest ~5.3K / ~21K / ~42K real prompt tokens.

| filled ctx | prompt tok/s | gen tok/s | TTFT | P40 VRAM peak | P40 util | P40 power peak | P40 temp peak | host CPU peak | ECC delta |
|---|---|---|---|---|---|---|---|---|---|
| 8K  | 736.4 | 24.0 | 9.3 s   | 6,119 MiB  | 100 % | 154 W | 51 °C | 27 % | 0 / 0 |
| 32K | 304.4 | 8.3  | 71.6 s  | 16,455 MiB | 100 % | 172 W | 69 °C | 35 % | 0 / 0 |
| 64K | 125.8 | 1.8  | 337.5 s | 16,661 MiB | 100 % | 177 W | **90 °C** | 48 % | 0 / 0 |

RTX 3050 across all runs: ≤ 834 MiB, ≤ 56 % — it stayed the display/utility card. Model load was
~2 s in every run (already resident). ECC volatile corrected/uncorrected: **0 delta** throughout.

## What the numbers say

**The P40 is compute- and thermally-bound at long filled context, not VRAM-bound.** Peak VRAM at
64K was 16.7 GiB of ~23 GiB usable — capacity to spare — while GPU utilisation sat pinned at 100 %
and host CPU stayed near idle (mean ~10 %). The old CPU-offload bottleneck is gone; Pascal compute
is now the limit.

**Degradation is steeply non-linear.** Generation falls 24 → 8.3 → 1.8 tok/s and prompt ingestion
736 → 304 → 126 tok/s as the KV cache fills. TTFT at 64K is ~337 s, essentially all of it prompt
ingestion (42K tokens ÷ 126 tok/s ≈ 334 s). A filled 64K context is not an interactive workload on
this card.

**Thermals are the binding physical constraint, confirmed under real work.** 90 °C peak at 64K
against a 92 °C slowdown threshold, at the 150 W cap, in a passively-cooled datacentre card sitting
in a workstation chassis. Power excursions to 154–177 W were sampled despite the 150 W limit
(brief draw above an enforced cap is expected instrumentation behaviour, but it is recorded rather
than smoothed away). `SUSTAINED = NOT_ADMITTED` stands, and airflow remains the prerequisite for
raising it.

## Comparison to the pre-P40 baseline — stated with its limit

The prior figure (~9 tok/s generation at 64K on the 6 GB configuration) is **not comparable to the
64K row above** unless that measurement also ingested ~42K real prompt tokens. A 64K *window* with
a short prompt is a much cheaper workload than a 64K *filled* context. No regression is claimed
here; what is established is the absolute behaviour of the current path at each fill level. A
like-for-like re-run of the old prompt is the only way to make the before/after claim honestly.

## Purchase implications (evidence, not recommendation-by-vibe)

- **A second P40 is not supported by this data.** It would add capacity that is not the constraint
  (16.7 of 23 GiB used at the hardest tested point) and would not raise single-stream generation
  speed; splitting a 4B model across two Pascal cards over PCIe does not fix a compute limit.
- **If long-context speed is the goal, the upgrade axis is architecture, not more VRAM** — a newer
  24 GB-class accelerator with tensor cores and working flash-attention.
- **The cheapest untested wins cost nothing in hardware**: airflow (90 °C is the live ceiling), and
  Ollama-side flags not yet evaluated here — `OLLAMA_FLASH_ATTENTION` and KV-cache quantisation —
  which target exactly the ingestion/KV cost that dominates these runs. Those should be measured
  before any purchase.

## Readiness — the acceptance condition this defect exposed

A local inference resource must **not** be considered ready because `/v1/models` returns 200. That
check passed for the proxy's own liveness while the upstream was dark. Readiness requires:

1. a real inference probe that returns generated content through the governed path, and
2. evidence that the **intended accelerator actually became active** — VRAM residency and
   utilisation observed on the target device during the probe.

Had that existed, this defect would have surfaced automatically instead of leaving a healthy P40
at 9 MiB for hours. This is the qualification bar for `hermes-local` and is recorded as a follow-up
requirement on this PR.
