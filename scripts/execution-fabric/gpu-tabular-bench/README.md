# GPU tabular capability qualification (DAEDALUS)

Bounded discovery/qualification lane for a **specialist tabular-ML compute capability** on the
DAEDALUS RTX 3090 (RAPIDS/cuML), measured against a CPU baseline on the same data.

This directory is **measurement only**. It does not add a scheduler, registry, agent framework,
dashboard, or memory system, and it does not promote anything: the capability remains a
`CANDIDATE` until an owner act admits it (see *Promotion boundary*).

## Why this workload shape

The estate's real county corpus lives in `pacs_oltp` on aegis (MSSQL): `change_log_keys` 1.34 B rows,
`tax_due_calc_list` 867 M, `coll_transaction` ~97 M, `property_val` / `owner` ~2.54 M,
`_clientdb_improvement_features` ~2.9 M, `sales_ratio_list` ~11 M.

That corpus is **county/protected data**. The Intelligence Fabric's capability inventory excludes
"county/PACS or protected data" for the Hermes worker, so this lane does **not** read, copy, or move
it. Instead the generator reproduces the *shape and scale* of the real workload with synthetic values,
which is what makes the measurement meaningful without an egress decision:

| real PACS object | synthetic stand-in | scale used |
|---|---|---|
| `property_val` + `_clientdb_improvement_features` | parcel feature matrix | 2,500,000 rows × 12 features |
| `coll_transaction` | collection-transaction stream | 20,000,000 rows × 5 columns |
| `sales_ratio_list` | assessed/sale ratio | derived from the above |

A benchmark against the **real** de-identified extract is a separate, owner-authorized action.

## Tasks (each a real assessor workload, not a toy)

1. `aggregation` — collection rollup per parcel (cuDF vs pandas)
2. `regression` — sale-price valuation model, RandomForest (cuML vs scikit-learn)
3. `clustering` — valuation-zone / comparable grouping, KMeans (cuML vs scikit-learn)
4. `decomposition` — PCA over parcel features (cuML vs scikit-learn)
5. `outlier` — sales-ratio anomaly detection, IsolationForest (cuML vs scikit-learn)

## What is measured (IF-05 benchmark matrix)

Per `docs/governance/williamos-intelligence-fabric/18-if-05-fabric-benchmark-matrix.md`, a bare
speedup is not evidence. Each run records: wall time per phase, **correctness parity between CPU and
GPU over several metrics per task** (worst relative delta against a stated tolerance — deliberately
not a single scalar, since some metrics are insensitive to a wrong result), peak host RSS, VRAM free
before *and* after each task, the **cold-start cost split into first import and first real device
work**, and any typed failure. Task order is alternated so warm caches cannot masquerade as a result.

Results land in `<out>/qualification.json` with `"promoted": false`. The `warnings` array names any
binding value that failed to resolve, so a degraded binding cannot pass as a complete one.

## Running it

```bash
# isolated venv on DAEDALUS (never the commissioned Qwen/HF runtime)
python3 -m venv ~/.venvs/cuml-qual
~/.venvs/cuml-qual/bin/pip install --extra-index-url=https://pypi.nvidia.com cuml-cu13 cudf-cu13 scikit-learn

~/.venvs/cuml-qual/bin/python benchmark.py --parcels 2500000 --transactions 20000000 --out full
```

Nsight Systems (user-dir install, no root — `apt` would need sudo and is out of bounds):

```bash
curl -sL -o nsys.run https://developer.nvidia.com/downloads/assets/tools/secure/nsight-systems/2026_4/NsightSystems-linux-public-2026.4.1.191-3860507.run
chmod +x nsys.run && ./nsys.run --noexec --nox11 --target ~/nsight-systems-2026.4.1
export PATH=~/nsight-systems-2026.4.1/pkg/bin:$PATH
nsys profile --trace=cuda,nvtx --output=nsys-tabular ~/.venvs/cuml-qual/bin/python profile_gpu.py
```

`profile_gpu.py` wraps each phase in an NVTX range (`host_to_device`, `regression_fit`,
`regression_predict`, `device_to_host`, `clustering_fit`, `pca_fit`) so the timeline answers the
transfer-vs-compute and overlap questions directly.

## Promotion boundary

Per the promotion rule in `docs/governance/executable-capability-inventory.md`, admission requires
provider identity, adapter conformance, exact authority evidence, path confinement, preventive trust
enforcement, output redaction, cancellation, and independent evidence capture — and a **reviewed
state transition**, not a documentation label. This lane supplies the measured evidence only. The
candidate binding is:

```
cuML 26.08.00 × CUDA 13.4 (pip runtime) × RTX 3090 24GB (CC 8.6) × ~/.venvs/cuml-qual
```

Candidate capability ids (proposed, NOT admitted): `TABULAR_ML_GPU`, `CLUSTERING_GPU`,
`DIMENSIONAL_REDUCTION_GPU`, `ANOMALY_DETECTION_GPU`. cuML is a **specialist compute/runtime
capability**, not an LLM or worker lane; Nsight is an **Evaluation Lab measurement provider**, not a
user-facing application or an authority source.

## Stopping conditions honored by this lane

No change to HERMES, TerraFusion production, or Windows security/network configuration; no UAC; no
failure to the commissioned runtime; no cloud spend; no county/protected-data use. The `apt`-based
Nsight install (which needs sudo) was deliberately avoided in favour of the user-dir `.run` payload.
