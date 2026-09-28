"""Single implementation of the reviewed GPU-tabular workloads.

Lives here because the measured capability and the production seam must execute THE SAME compute:
the qualification harness (benchmark.py) and the dispatched jobs (resident-gpu-tabular-worker.py)
both call these functions, so a production job cannot silently diverge from what was measured.
benchmark.py originally held each body inside a task_*() pair runner; the bodies moved here
verbatim, preserving each side's load-inside/load-outside timing exactly as measured:

  * regression / clustering / decomposition / outlier: the caller loads the frame and passes
    NumPy arrays, because in the pair runner the parquet load sat OUTSIDE the timed closure;
  * aggregation: the path is passed and read inside, because in the pair runner BOTH sides read
    the parquet inside their timed closure.

Return shapes match the original inner closures exactly (float for regression/clustering, dict for
aggregation/decomposition, int for outlier) so the pair runner's evidence JSON is byte-compatible
with the reviewed records; execute() normalizes a scalar to {"value": scalar} for the worker.

Model parameters are frozen at the reviewed values on purpose: the capability was measured, and
then admitted, for these workload definitions. Re-tuning a model is a scope question, not a
placement question. Import stays lazy (inside each function) so a CPU-only run never pays a
cuML/CuPy import, mirroring the harness's cold-start semantics.
"""
from __future__ import annotations

import time

import numpy as np


def to_numpy(value):
    """Host NumPy view of a value that may be device-resident.

    Two distinct device paths exist and both refuse implicit conversion:
      * cuDF Series/DataFrame  -> .to_numpy()
      * CuPy ndarray           -> .get()
    np.asarray() on either raises in the installed versions, so each is handled explicitly.
    """
    if hasattr(value, "to_numpy"):
        return value.to_numpy()
    if (type(value).__module__ or "").split(".")[0] == "cupy" and hasattr(value, "get"):
        return value.get()
    return np.asarray(value)


def _require_device(device: str) -> str:
    if device not in ("cpu", "cuda"):
        raise ValueError(f"device must be 'cpu' or 'cuda', got {device!r}")
    return device


def run_timed(fn):
    """(value, seconds, error) — the pair runner's timing contract."""
    started = time.perf_counter()
    try:
        value = fn()
        return value, time.perf_counter() - started, None
    except Exception as exc:  # noqa: BLE001 - the harness reports errors as evidence
        return None, time.perf_counter() - started, f"{type(exc).__name__}: {exc}"


# --------------------------------------------------------------------------- regression


def workload_regression(device: str, features, target) -> float:
    """Sale-price valuation model (cuML RandomForestRegressor vs sklearn)."""
    _require_device(device)

    if device == "cpu":
        from sklearn.ensemble import RandomForestRegressor

        model = RandomForestRegressor(n_estimators=40, max_depth=14, n_jobs=-1, random_state=7)
        model.fit(features, target)
        predictions = model.predict(features[:200000])
        return float(np.sqrt(np.mean((predictions - target[:200000]) ** 2)))

    from cuml.ensemble import RandomForestRegressor

    model = RandomForestRegressor(n_estimators=40, max_depth=14, random_state=7)
    model.fit(features, target)
    predictions = model.predict(features[:200000])
    predictions = to_numpy(predictions).ravel()
    return float(np.sqrt(np.mean((predictions - target[:200000]) ** 2)))


# --------------------------------------------------------------------------- clustering


def workload_clustering(device: str, features) -> float:
    """Valuation-zone / comparable grouping (cuML KMeans vs sklearn)."""
    _require_device(device)

    if device == "cpu":
        from sklearn.cluster import KMeans

        model = KMeans(n_clusters=24, n_init=4, random_state=7)
        model.fit(features)
        return float(model.inertia_)

    from cuml.cluster import KMeans

    model = KMeans(n_clusters=24, n_init=4, random_state=7)
    model.fit(features)
    return float(model.inertia_)


# --------------------------------------------------------------------------- aggregation


def workload_aggregation(device: str, tx_path: str) -> dict:
    """Collection rollup per parcel — the 100M-row case (cuDF groupby vs pandas).

    The parquet read sits INSIDE, exactly as the pair runner measured it.
    """
    _require_device(device)

    if device == "cpu":
        import pandas as pd

        frame = pd.read_parquet(tx_path)
        grouped = frame.groupby("parcel_id", as_index=False).agg(
            total_amount=("amount", "sum"), tx_count=("amount", "size"), late_count=("late", "sum")
        )
        return {
            "rows": int(len(frame)),
            "groups": int(len(grouped)),
            "sum": float(grouped["total_amount"].sum()),
            "max_group_total": float(grouped["total_amount"].max()),
        }

    import cudf

    frame = cudf.read_parquet(tx_path)
    grouped = frame.groupby("parcel_id", as_index=False).agg(
        {"amount": ["sum", "count"], "late": "sum"}
    )
    totals = to_numpy(grouped.iloc[:, 1].astype("float64"))
    return {
        "rows": int(len(frame)),
        "groups": int(len(grouped)),
        "sum": float(totals.sum()),
        "max_group_total": float(totals.max()),
    }


# --------------------------------------------------------------------------- decomposition


def workload_decomposition(device: str, features) -> dict:
    """PCA over parcel features (cuML PCA vs sklearn).

    Authorized placement for this class is CPU at every measured size; the cuda branch exists so
    the shared module can serve the pair runner unchanged, NOT to widen production scope.
    """
    _require_device(device)

    if device == "cpu":
        from sklearn.decomposition import PCA

        model = PCA(n_components=8, random_state=7)
        model.fit(features)
        return {
            "pc1_explained_ratio": float(model.explained_variance_ratio_[0]),
            "leading_variance_l2": float(np.linalg.norm(model.explained_variance_)),
        }

    from cuml.decomposition import PCA

    model = PCA(n_components=8)
    model.fit(features)
    ratio = to_numpy(model.explained_variance_ratio_)
    variance = to_numpy(model.explained_variance_)
    return {
        "pc1_explained_ratio": float(ratio[0]),
        "leading_variance_l2": float(np.linalg.norm(variance)),
    }


# --------------------------------------------------------------------------- outlier


def workload_outlier(device: str, features) -> int:
    """Sales-ratio outlier detection (cuML vs sklearn IsolationForest).

    Screening-only capability: production dispatch refuses it; the pair runner still measures it.
    """
    _require_device(device)

    if device == "cpu":
        from sklearn.ensemble import IsolationForest

        model = IsolationForest(n_estimators=100, random_state=7, n_jobs=-1)
        labels = model.fit_predict(features)
        return int((labels == -1).sum())

    from cuml.ensemble import IsolationForest

    model = IsolationForest(n_estimators=100, random_state=7)
    labels = model.fit_predict(features)
    labels = to_numpy(labels).ravel()
    return int((labels == -1).sum())


# --------------------------------------------------------------------------- data loading

WORKLOADS = ("regression", "clustering", "aggregation", "decomposition", "outlier")


def load_features(parcels_path: str, drop_column: str = "sale_price"):
    """Frame -> float32 feature matrix, exactly as the pair runners load it (outside timing)."""
    import pandas as pd

    frame = pd.read_parquet(parcels_path)
    return frame.drop(columns=[drop_column]).to_numpy(dtype="float32")


def load_regression_arrays(parcels_path: str):
    import pandas as pd

    frame = pd.read_parquet(parcels_path)
    features = frame.drop(columns=["sale_price"]).to_numpy(dtype="float32")
    target = frame["sale_price"].to_numpy(dtype="float32")
    return features, target


def load_outlier_features(parcels_path: str):
    import pandas as pd

    frame = pd.read_parquet(parcels_path)
    ratio = (frame["assessed_total"] / frame["sale_price"]).to_numpy(dtype="float32")
    return ratio.reshape(-1, 1)


def execute(workload: str, device: str, *, parcels_path=None, tx_path=None,
            features=None, target=None) -> dict:
    """Run one workload on one device. Returns {"value": {...}, "seconds": float} or raises."""
    if workload not in WORKLOADS:
        raise ValueError(f"unknown workload {workload!r}")
    if workload == "aggregation":
        if not tx_path:
            raise ValueError("aggregation requires tx_path")
        value, seconds, error = run_timed(lambda: workload_aggregation(device, tx_path))
    else:
        if workload == "regression":
            if features is None or target is None:
                if not parcels_path:
                    raise ValueError("regression requires features+target or parcels_path")
                features, target = load_regression_arrays(parcels_path)
            value, seconds, error = run_timed(
                lambda: workload_regression(device, features, target))
        elif workload == "clustering":
            if features is None:
                features = load_features(parcels_path)
            value, seconds, error = run_timed(lambda: workload_clustering(device, features))
        elif workload == "decomposition":
            if features is None:
                features = load_features(parcels_path)
            value, seconds, error = run_timed(lambda: workload_decomposition(device, features))
        else:  # outlier
            if features is None:
                features = load_outlier_features(parcels_path)
            value, seconds, error = run_timed(lambda: workload_outlier(device, features))
    if error:
        raise RuntimeError(error)
    normalized = value if isinstance(value, dict) else {"value": value}
    return {"value": normalized, "seconds": seconds}
