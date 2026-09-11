# Placement thresholds — GPU tabular capability (DAEDALUS)

**Status:** `MEASURED — PLACEMENT INPUT, NOT A PROMOTION`. These thresholds tell the placement path
*where* the CPU/GPU switch belongs. They do not admit the capability; that remains a reviewed
transition (see the promotion section of
`gpu-tabular-daedalus-2026-09-11.md`).

**Binding under test:** DAEDALUS · RTX 3090 24GB (CC 8.6) · cuML 26.08.00 / cuDF 26.08.01 ·
CUDA runtime 13.4.49 · `/home/daedalus/.venvs/cuml-qual`.

## Why this exists

The qualification run measured two scale points (60 k, 2.5 M) and could prove only that *size matters*.
It could not tell HERMES where to switch. Two points cannot support an automatic placement rule, so
this sweep measures the curve.

## Method, and one correction it forced

`sweep.py` **reuses the reviewed task functions and generators from `benchmark.py`** — the curve is
measured by the code that produced the qualification evidence, not a second implementation. Margin is
25%: the GPU must beat the CPU by at least that much, at the candidate size *and* at every larger
measured size, or the task stays on the CPU path.

The first sweep run was **wrong, and its wrongness was visible in the data**: regression at 50 k
measured *slower* (1.656 s) than at 100 k (0.773 s) — impossible for a smaller input. The cause was
one-off cost (module import, CUDA context, each library's first call, and cuDF's parquet-reader setup)
landing inside whichever task ran first in the process. Measured directly at 2.5 M, the *same*
aggregation workload takes **0.724 s running first in the process and 0.111 s running later** — a 6.5×
swing from ordering alone. All three evidence files were therefore re-measured with an explicit
warm-up (`warm_runtimes()`), which pays those costs before any timer starts and reports them
separately. The one-off cost is real and still recorded; it is simply not charged to a task.

That correction moved two derived thresholds and materially changed published numbers (below).

## The measured curve (warm, CPU/GPU ratio — higher means the GPU wins by more)

| Rows | regression | clustering | aggregation |
|---|---|---|---|
| 50,000 | 1.368 | 3.387 | 1.123 |
| 100,000 | 2.140 | 2.561 | 1.728 |
| 250,000 | 4.261 | 3.151 | 2.882 |
| 500,000 | 7.556 | 2.405 | 8.635 |
| 1,000,000 | 12.296 | 3.651 | 16.719 |
| 2,500,000 | 20.377 | 4.803 | 35.404 |

Correctness was checked at every point: parity passes at all 18 measurements (6 sizes × 3 tasks).
Aggregation sizes use 8 transactions per parcel, so the 2,500,000 row point carries 20,000,000
transactions.

## Derived thresholds

| Task | GPU-preferred at or above | Crossover at measurement floor? | Below the threshold |
|---|---|---|---|
| regression | 50,000 rows | **yes** | CPU path |
| clustering | 50,000 rows | **yes** | CPU path |
| aggregation | 100,000 rows | no | CPU path |

Read these honestly:

* **regression and clustering clear the margin at the smallest size measured.** Their true crossover is
  at or below 50,000 rows and is **unmeasured** there. The CPU default below the threshold is a
  conservative choice, not a measured one; narrowing it needs a sweep below 50 k.
* **aggregation is faster on the GPU at every measured size** (1.123× even at 50 k) but is only
  *preferred* at 100 k, where it clears the 25% margin. It is the one task whose switch point is
  actually bracketed by measurements.
* **A task with no measured size clearing the margin is reported `insufficientEvidence` and stays on
  the CPU path.** No task is in that state here.

## Not covered

* `ANOMALY_DETECTION_GPU` — deliberately excluded from this sweep. It fails its own parity tolerance at
  small scale (0.372 vs 0.35), so it is screening-only and gets no automatic-placement threshold.
* `DIMENSIONAL_REDUCTION_GPU` — CPU wins at every measured size; no GPU threshold is claimed.
* Sizes below 50,000 rows, multi-GPU, and concurrent workloads.

## Eligibility shape this feeds (not yet wired)

```
capability: TABULAR_ML_GPU | CLUSTERING_GPU
binding:    DAEDALUS / RTX 3090 / cuML 26.08 / CUDA 13.4
eligible when:
  workload is in the supported scope
  measured rows >= that workload's crossover threshold
  GPU capacity fresh
  parity profile approved
otherwise:
  CPU path
```

Wiring this into automatic placement is the integration lane's job, and the enforcement source stays
the machine registry and its dispatch evaluator — this record only supplies the measured thresholds.

## Correction to the published qualification record

The warm-up fix changed numbers that were already on `main`, all in the same direction — one-off cost
was being charged to whichever task ran first:

| Measurement | Previously published | Corrected (warm) |
|---|---|---|
| aggregation @ 2.5 M | 4.82× | **18.70×** |
| aggregation @ 60 k | 0.047× (GPU ~21× slower) | **0.79×** (near break-even) |
| PCA @ 2.5 M | 0.39× | **0.75×** |
| PCA @ 60 k | 0.020× | **0.65×** |

The qualitative placement conclusions in that record survive — PCA and small-input aggregation still
favour the CPU — but the magnitudes were overstated, in the GPU's disfavour. The corrected figures are
in the updated qualification record.
