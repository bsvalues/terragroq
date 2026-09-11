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
| CPU / RAM | 24 cores / 62 GB |
| Runtime | `cuml 26.08.00` + `cudf 26.08.01` (pip CUDA-13 wheels, `cuml-cu13`/`cudf-cu13` 26.8.x) |
| CuPy / sklearn | `cupy-cuda13x 14.2.0` / `scikit-learn 1.9.1`, numpy 2.4.6, pandas 3.0.3 |
| Environment | `~/.venvs/cuml-qual` — **isolated**; the commissioned Qwen/HF runtime is untouched |
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

| Task | CPU | GPU | CPU/GPU | Parity | Relative delta | Tolerance |
|---|---|---|---|---|---|---|
| aggregation (20 M tx rollup) | 3.84 s | 0.75 s | **5.1×** | PASS | 0.0 (exact) | 2% |
| valuation regression (2.5 M parcels) | 83.73 s | 4.23 s | **19.8×** | PASS | 0.021 (RMSE 2.1%) | 30% |
| valuation-zone clustering | 21.36 s | 4.34 s | **4.9×** | PASS | 0.0010 | 5% |
| PCA (12 features) | 0.04 s | 0.13 s | **0.28× — CPU wins** | PASS | 0.0 | 2% |
| sales-ratio outliers | 10.08 s | 0.03 s | **310×** | PASS | 0.081 | 35% |

Cold start (first real device work, context + first kernel): **0.398 s**. Peak host RSS: **5.09 GB**.

**Same workloads at small scale (60,000 parcels / 300,000 tx) invert the story** — GPU is *slower* on
regression (0.87 s CPU vs 4.17 s GPU, 0.21×) and PCA (0.0015 s vs 0.049 s, 0.03×), while clustering
(2.8×) and outlier detection (4.3×) still win. **Placement relevance: the accelerator pays only above
a size threshold; a small input should stay on CPU.** Two of the five tasks are size-sensitive enough
that a naive "GPU is faster" placement rule would regress.

Honest caveats: (a) `outlier` parity is 8.1% — cuML and scikit-learn IsolationForest differ in
sampling/split semantics, so the outlier *count* is comparable but not identical; (b) `PCA` at this
width is transfer- and launch-dominated and should not be placed on GPU; (c) single-run wall times on
a shared desktop-class card are not a benchmark of sustained throughput (the IF-05 matrix's
sustained/thermal dimension is not covered by this run).

## 4. Nsight Systems evidence (same workload, 2.5 M parcels, GPU path)

NVTX phase ranges:

| Phase | Time | Share of window |
|---|---|---|
| `regression_fit` | 4.4617 s | 29.1% |
| `host_to_device` | 0.6333 s | 4.1% |
| `synthetic_generation` | 0.5153 s | 3.4% |

Kernel time is dominated by one class:

| Kernel | GPU time | Share of kernel time | Instances |
|---|---|---|---|
| `ML::DT::buildHistogramsKernel<...>` (RF histogram build) | 3.1881 s | **85.5%** | 1200 |
| `cub scan_by_key` (node-split partition) | 0.1891 s | 5.1% | 600 |
| `ML::DT::countLocalLeftKernel` | 0.1439 s | 3.9% | 600 |
| `ML::DT::findBestSplitsKernel` | 0.0793 s | 2.1% | 1200 |
| `ML::DT::leafKernel` | 0.0336 s | 0.9% | 40 |

Device-side memory activity is **not** the bottleneck: `memcpy Host-to-Device` 40.5 ms total across
3,087 calls (largest single 6.55 ms), `memset` 26.5 ms, `memcpy Device-to-Host` 6.1 ms.

**Findings that matter for placement:** the workload is **compute-bound, not transfer-bound** — the
host-side H2D wall time (0.63 s, pageable synchronous copies) is ~14% of the fit, and the GPU-side
copy time is only 40 ms. Within the compute, ~85% of kernel time sits in the RandomForest histogram
kernel, so tree-model tuning (bin count, histogram budget) is the lever, not data movement. Because
no single kernel is a launch-bound micro-kernel, Nsight Compute is **not** warranted yet — the
Systems-level question ("where does the time go?") has a clear answer.

## 5. Candidate capability (proposed, NOT admitted)

```
cuML 26.08.00 × CUDA 13.4 (pip runtime) × RTX 3090 24GB (CC 8.6) × ~/.venvs/cuml-qual
```

Proposed ids: `TABULAR_ML_GPU`, `CLUSTERING_GPU`, `DIMENSIONAL_REDUCTION_GPU`,
`ANOMALY_DETECTION_GPU`. Evidence suggests scoping the useful set to **`TABULAR_ML_GPU`**
(tree ensembles), **`CLUSTERING_GPU`** and **`ANOMALY_DETECTION_GPU`** at ≥ ~1 M rows, and **excluding**
dimensional reduction from an accelerator binding at this feature width.

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
