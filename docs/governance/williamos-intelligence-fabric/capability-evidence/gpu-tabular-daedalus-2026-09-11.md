# Capability evidence — GPU tabular ML on DAEDALUS (cuML/RAPIDS)

**Status:** `MEASURED — NOT PROMOTED`. This record supplies evidence only. Admission of the
capability is a reviewed owner act (promotion rule, `executable-capability-inventory.md`).
**Lane:** bounded discovery/qualification, separate from the external model-API commissioning work.
**Date of measurement:** 2026-09-11. **Harness:** `scripts/execution-fabric/gpu-tabular-bench/`.

## 1. Binding under measurement

| Element | Value |
|---|---|
| Node | DAEDALUS (`~192.168.88.6`) |
| Accelerator | NVIDIA GeForce RTX 3090, 24,576 MiB, compute capability 8.6 |
| Driver | 595.84 |
| OS / kernel | Ubuntu 24.04, kernel 7.0.0-31 |
| CPU / RAM | 24 cores (`host.cpuCount`) / 67,263,365,120 bytes = 62.6 GiB (`host.totalMemoryBytes`) |
| Runtime | `cuml 26.08.00` + `cudf 26.08.01` (pip CUDA-13 wheels, `cuml-cu13`/`cudf-cu13` 26.8.x) |
| CUDA runtime | `nvidia-cuda-runtime 13.4.49`, `cuda-toolkit 13.4.1.0` (recorded from the installed distributions) |
| CuPy / sklearn | `cupy-cuda13x 14.2.0` / `scikit-learn 1.9.1`, numpy 2.4.6, pandas 3.0.3 |
| Environment | `/home/daedalus/.venvs/cuml-qual` — **isolated**; the commissioned Qwen/HF runtime is untouched |
| Nsight Systems | 2026.4.1, extracted to `~/nsight-systems-2026.4.1` (user-dir `.run`, no root) |

Compatibility was verified by live pip resolution and import before any measurement: the CUDA-13
RAPIDS wheels require driver ≥ 580.65.06 (have 595.84), support Python 3.12 (have 3.12.3), and the
3090 is a supported architecture.

## 2. Workload

The estate's real county corpus is `pacs_oltp` on aegis: `change_log_keys` 1,341,449,389 rows,
`tax_due_calc_list` 867,583,752, `change_log` 264,233,840, `coll_transaction` 97,472,617,
`property_audit_trail` 82,718,765, `sales_ratio_list` 10,995,704, `_clientdb_improvement_features`
2,893,868, `property_val`/`owner` ~2,539,000.

**That corpus is county/protected data and was not read, copied, or moved.** The generator reproduces
its shape and scale synthetically (2,500,000 parcels × 12 features — 74.8 MB parquet; 20,000,000
collection transactions × 5 columns — 233.2 MB parquet), which is what makes the measurement
meaningful inside standing authority. A real de-identified extract would be a separate owner-granted run.

Five workloads, each a real assessor task: collection rollup per parcel; sale-price valuation
regression (RandomForest); valuation-zone clustering (KMeans); parcel PCA; sales-ratio anomaly
detection (IsolationForest).

## 3. Results — CPU baseline vs GPU (full scale, 0 failures)

| Task | CPU | GPU | CPU/GPU | Parity | Worst metric delta | Tolerance |
|---|---|---|---|---|---|---|
| aggregation (20 M tx rollup) | 3.76 s | 0.20 s | **18.70×** | PASS | 0.0 (exact) | 2% |
| valuation regression (2.5 M parcels) | 83.83 s | 4.18 s | **20.04×** | PASS | 0.0210 (RMSE 2.1%) | 30% |
| valuation-zone clustering | 21.15 s | 4.36 s | **4.85×** | PASS | 0.00097 | 5% |
| PCA (12 features) | 0.035 s | 0.046 s | **0.75× — CPU wins** | PASS | 0.000007 | 2% |
| sales-ratio outliers | 9.96 s | 0.030 s | **335×** | PASS | 0.0808 | 35% |

Cold start, split honestly: first CuPy **import 0.130 s**, first real **device work 0.201 s**, plus an
explicit warm-up of **0.379 s**. Every task is then timed from that warm state, so no task carries
one-off setup. That is a correction to earlier revisions of this record, which charged setup to
whichever task ran first — the measurement that forced it, and the numbers it changed, are in
`gpu-tabular-placement-thresholds-2026-09-11.md`.

Peak host RSS **5.07 GB** (decimal). Zero failures, zero unresolved-binding warnings,
`parityFailures: []`.

Parity is stated over several metrics per task wherever a single scalar would be insensitive to a
wrong result: aggregation compares the total, the group count *and* the largest group, and PCA
compares the dominant component's share and the leading-variance magnitude — `explained_variance_ratio_`
alone sums to 1.0 by construction and can never detect a wrong decomposition.

The §4 profiling capture is a separate measurement of the same workload by a different tool. Where it
overlaps, it agrees with the benchmark's GPU-side timings to within ~10% (profile `regression_fit`
4.4372 s vs benchmark GPU 4.18 s; profile `clustering_fit` 4.0126 s vs benchmark GPU 4.36 s). It does
**not** cover the aggregation task — `profile_gpu.py` runs no cuDF groupby — so aggregation rests on
the benchmark evidence alone.

Run-to-run stability, measured on two full-scale runs from this same revision
(`qualification-full-2.5M.json` and `qualification-full-2.5M-run2.json`, both executed from the harness
as committed in this revision — unchanged between the two runs): GPU seconds agree to 1.3%
(aggregation), 0.3% (regression), 2.2% (clustering), 1.5% (PCA) and 2.1% (outlier) — every task stable
to within ~2%. PCA is in that list deliberately: before the warm-up fix it varied 21% between runs,
because it was timing a cold-dominated slice rather than the workload.

### Small input (60,000 parcels / 300,000 tx) — where the accelerator loses

| Task | CPU | GPU | CPU/GPU | Parity |
|---|---|---|---|---|
| aggregation | 0.025 s | 0.032 s | **0.79× — CPU ahead** | PASS |
| PCA | 0.0015 s | 0.0024 s | **0.65× — CPU wins** | PASS |
| regression | 0.845 s | 0.659 s | 1.28× | PASS |
| clustering | 0.509 s | 0.159 s | 3.19× | PASS |
| sales-ratio outliers | 0.384 s | 0.010 s | 37.1× | **FAIL — 0.372 vs 0.35 tolerance** |

This run reports `parityFailures: ["outlier"]` — a machine-readable signal, so a reader does not have
to infer a parity miss from a nested flag inside an otherwise clean `failures: []`.

**Placement relevance:** at this size the accelerator is not worth using, but the penalty is modest —
the CPU is ahead by roughly 20–35%, not by orders of magnitude — and two of five tasks still regress
under a naive "GPU is faster" rule. Earlier revisions of this record reported 0.048× and 0.020× here;
those figures charged one-off setup to the first task in the process (see the thresholds record). The
*direction* of the conclusion held; the magnitude was overstated against the GPU. Precise switch points
are now measured in `gpu-tabular-placement-thresholds-2026-09-11.md`.

**Outlier detection carries the weakest correctness signal.** cuML and scikit-learn IsolationForest
differ in sampling and split semantics: the outlier *count* is comparable at full scale (8.1% delta
inside a 35% tolerance) but **exceeds its tolerance at small scale (37.2%)**, and the tolerance itself
is deliberately loose. The 335× speedup is real; "same answer" is not. It is a screening workload, not
a drop-in replacement.

Not covered by this run: sustained/thermal throughput on a shared desktop-class card (the IF-05
matrix's sustained dimension), and multi-GPU or concurrent-workload behaviour.

## 4. Nsight Systems evidence (same workload, 2.5 M parcels, GPU path)

Capture covers the **complete** workload — RandomForest fit and predict, KMeans, and PCA all ran to
completion under the profiler (`rows=2500000`, process exit 0). The capture target is
`profile_gpu.py`; the phase ranges are NVTX annotations, so the timeline below is the tool's own
measurement, not a self-report.

NVTX phase ranges (share of the profile window):

| Phase | Time | Share |
|---|---|---|
| `regression_fit` (RF, 40 trees) | 4.4372 s | 22.9% |
| `clustering_fit` (KMeans, 24 clusters) | 4.0126 s | 20.7% |
| `host_to_device` | 0.6017 s | 3.1% |
| `synthetic_generation` | 0.5167 s | 2.7% |
| `pca_fit` | 0.0872 s | 0.4% |

Kernel time — **two** dominant families, not one:

| Kernel | GPU time | Share of kernel time | Instances |
|---|---|---|---|
| `ML::DT::buildHistogramsKernel<...>` (RF histogram build) | 3.1866 s | 42.3% | 1200 |
| `cutlass_cuvs_cutlass::Kernel<...FusedDistanceNNPersistent...>` (cuVS nearest-neighbour / KMeans) | 2.7924 s | 37.0% | 416 |
| `raft::linalg::sum_rows_by_key_large_nkeys_kernel_rowmajor` (KMeans centroid update) | 0.5802 s | 7.7% | 411 |
| `cutlass_cuvs_cutlass::Kernel<...>` (PCA path) | 0.3479 s | 4.6% | 48 |
| `cub scan_by_key` (node-split partition) | 0.1899 s | 2.5% | 600 |
| `ML::DT::countLocalLeftKernel` | 0.1441 s | 1.9% | 600 |

Device-side memory activity is **not** the bottleneck: `memcpy Host-to-Device` 40.0 ms total across
3,992 calls (largest single 6.48 ms), `memset` 31.8 ms, `memcpy Device-to-Host` 6.4 ms,
`Device-to-Device` 0.47 ms.

**Findings that matter for placement:** the workload is **compute-bound, not transfer-bound** — the
host-side H2D wall time (0.60 s, pageable synchronous copies) is ~14% of the RF fit, and total
device-side copy time is ~40 ms against ~8.4 s of fit compute across the two tree/cluster paths.
Within that compute, two kernel families split the time almost evenly: RandomForest histogram
building (42.3%) and the cuVS nearest-neighbour distance kernel used by KMeans (37.0%), with KMeans
centroid reduction a further 7.7%. So the levers are tree histogram/bin budget and KMeans
distance/centroid strategy — **not** data movement. No micro-kernel is launch-bound, so Nsight
Compute is **not** warranted: the Systems-level question ("where does the time go?") has a clear
answer.

Both harness defects found while producing this capture are fixed in `profile_gpu.py`: an invalid
NVTX color name (the built-in palette is limited without matplotlib) that silently truncated the
first capture, and `np.asarray()` on a CuPy result, which modern CuPy refuses.

## 5. Candidate capability (proposed, NOT admitted)

```
cuML 26.08.00 × CUDA 13.4 (pip runtime) × RTX 3090 24GB (CC 8.6) × ~/.venvs/cuml-qual
```

Proposed ids: `TABULAR_ML_GPU`, `CLUSTERING_GPU`, `DIMENSIONAL_REDUCTION_GPU`,
`ANOMALY_DETECTION_GPU`. The measured evidence supports a narrower scope than the id list suggests:

* **`TABULAR_ML_GPU`** (tree ensembles over parcel-scale rows) — strongest case: 20.0× at 2.5 M rows
  with 2.1% RMSE parity, stable across two same-revision runs, and its fit independently timed by the
  §4 capture (4.44 s there vs 4.18 s here). Measured crossover: prefers the GPU at or above
  **50,000 rows** (at the measurement floor — see the thresholds record).
* **`CLUSTERING_GPU`** — solid at both measured scales (4.9× / 3.2×) with sub-1% inertia parity;
  prefers the GPU at or above **50,000 rows**.
* **`ANOMALY_DETECTION_GPU`** — fast (335×) but the *answer* is implementation-dependent: parity
  passes at full scale and fails at small scale. Screening only, with **no** automatic-placement
  threshold.
* **`DIMENSIONAL_REDUCTION_GPU`** — **not supported** at this feature width (0.75× at 2.5 M rows,
  0.65× at 60 k — the CPU wins at every measured size). Do not bind it.
* **Aggregation / rollup work** — size-aware only: 0.79× at 60 k rows, preferring the GPU from
  **100,000 rows**. Never blanket-GPU.

All of the above are recommendations from measurement. Nothing here is a binding.

Per the promotion rule, admission would still require provider identity, adapter conformance, exact
authority evidence, path confinement, preventive trust enforcement, output redaction, cancellation,
independent evidence capture, and a reviewed transition. **None of that is claimed here.** cuML is a
specialist compute/runtime capability (not an LLM or worker lane); Nsight is an Evaluation Lab
measurement provider (not a user-facing application or authority source).

## 6. Boundary — what this lane did not do

No change to HERMES, TerraFusion production, or Windows security/network configuration; no UAC; no
change to the commissioned DAEDALUS runtime; no cloud spend; no county/protected-data use. The
`apt`-based Nsight install (needing sudo) was deliberately avoided in favour of the user-dir `.run`
payload. No scheduler, registry, agent framework, dashboard, or memory system was added.
