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
| aggregation (20 M tx rollup) | 3.87 s | 0.80 s | **4.82×** | PASS | 0.0 (exact) | 2% |
| valuation regression (2.5 M parcels) | 83.70 s | 4.21 s | **19.87×** | PASS | 0.0210 (RMSE 2.1%) | 30% |
| valuation-zone clustering | 20.98 s | 4.32 s | **4.86×** | PASS | 0.00098 | 5% |
| PCA (12 features) | 0.035 s | 0.089 s | **0.39× — CPU wins** | PASS | 0.000007 | 2% |
| sales-ratio outliers | 10.05 s | 0.031 s | **323×** | PASS | 0.0808 | 35% |

Cold start, split honestly: first CuPy **import 0.126 s**, first real **device work 0.276 s**. Peak
host RSS **5.20 GB**. Zero failures, zero unresolved-binding warnings, `parityFailures: []`.

Parity is stated over several metrics per task wherever a single scalar would be insensitive to a
wrong result: aggregation compares the total, the group count *and* the largest group, and PCA
compares the dominant component's share and the leading-variance magnitude — `explained_variance_ratio_`
alone sums to 1.0 by construction and can never detect a wrong decomposition.

The §4 profiling capture is a separate measurement of the same workload by a different tool. Where it
overlaps, it agrees with the benchmark's GPU-side timings to within ~10% (profile `regression_fit`
4.4372 s vs benchmark GPU 4.21 s; profile `clustering_fit` 4.0126 s vs benchmark GPU 4.36 s). It does
**not** cover the aggregation task — `profile_gpu.py` runs no cuDF groupby — so aggregation rests on
the benchmark evidence alone.

Run-to-run stability, measured on two full-scale runs from this same revision
(`qualification-full-2.5M.json` and `qualification-full-2.5M-run2.json`): GPU seconds agree to 0.9%
(aggregation), 0.2% (regression), 0.0% (clustering) and 1.1% (outlier). PCA differs by 21% between the
two runs — it completes in ~0.1 s, where scheduler noise dominates — so the 0.39× should be read as
"CPU wins clearly", not as a precise figure.

### Small input (60,000 parcels / 300,000 tx) — where the accelerator loses

| Task | CPU | GPU | CPU/GPU | Parity |
|---|---|---|---|---|
| aggregation | 0.030 s | 0.652 s | **0.047× — GPU ~21× slower** | PASS |
| PCA | 0.0014 s | 0.069 s | **0.020× — GPU ~50× slower** | PASS |
| regression | 0.851 s | 0.708 s | 1.20× | PASS |
| clustering | 0.483 s | 0.195 s | 2.47× | PASS |
| sales-ratio outliers | 0.379 s | 0.014 s | 27.6× | **FAIL — 0.372 vs 0.35 tolerance** |

This run reports `parityFailures: ["outlier"]` — a machine-readable signal, so a reader does not have
to infer a parity miss from a nested flag inside an otherwise clean `failures: []`.

**Placement relevance:** the accelerator pays only above a size threshold. The deepest inversions are
PCA (~50× slower on GPU) and aggregation (~21× slower) — in both, the work per row is small enough that
cuDF/cuML fixed overhead dominates. A naive "GPU is faster" rule would regress two of the five tasks at
small input. An earlier measurement of this same case reported regression at 0.21×; that was an artifact
of the first GPU task in the process absorbing CUDA/cuML warm-up, which is why cold start is now measured
separately and before any other device work.

**Outlier detection carries the weakest correctness signal.** cuML and scikit-learn IsolationForest
differ in sampling and split semantics: the outlier *count* is comparable at full scale (8.1% delta
inside a 35% tolerance) but **exceeds its tolerance at small scale (37.2%)**, and the tolerance itself
is deliberately loose. The 323× speedup is real; "same answer" is not. It is a screening workload, not
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

* **`TABULAR_ML_GPU`** (tree ensembles over parcel-scale rows) — strongest case: 19.9× at 2.5 M rows
  with 2.1% RMSE parity, stable across two same-revision runs, and its fit independently timed by the
  §4 capture (4.44 s there vs 4.21 s here).
* **`CLUSTERING_GPU`** — solid at both scales (4.9× / 2.5×) with sub-1% inertia parity.
* **`ANOMALY_DETECTION_GPU`** — fast (323×) but the *answer* is implementation-dependent: parity
  passes at full scale and fails at small scale. Bind it only as a screening step with a stated
  tolerance, never as a drop-in replacement.
* **`DIMENSIONAL_REDUCTION_GPU`** — **not supported** at this feature width (0.39×, and 0.020× at
  small input). CPU wins; do not bind it.
* **Aggregation / rollup work** — supported only above the size threshold; at 60 k rows cuDF loses by
  ~21×. A placement rule must be size-aware, not class-aware alone.

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
