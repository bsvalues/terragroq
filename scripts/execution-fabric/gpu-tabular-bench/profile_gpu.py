#!/usr/bin/env python3
"""Nsight Systems capture target: the GPU side of the tabular qualification workload.

Deliberately explicit about the phases Nsight must see on the timeline:
  host_to_device -> regression_fit -> regression_predict -> device_to_host -> clustering_fit
so the report answers the questions the IF-05 benchmark matrix actually asks: how much time is
transfer versus compute, whether host and device overlap, where synchronisation happens, and which
kernel dominates. Synthetic data only (no county rows), mirroring pacs_oltp shape.

NOTE: without matplotlib installed, nvtx accepts only its built-in palette — green, blue, yellow,
purple, rapids, cyan, red, white, darkgreen, orange. Any other name (e.g. "olive") raises TypeError
at the annotate() call and aborts the run mid-profile, silently truncating the capture.
"""
from __future__ import annotations

import os
import sys
import time

import numpy as np

OUT = os.path.dirname(os.path.abspath(__file__))
PARCELS = int(os.environ.get("PROFILE_PARCELS", "2500000"))
SEED = 20260911


def main() -> int:
    import cupy
    import nvtx
    from cuml.cluster import KMeans
    from cuml.decomposition import PCA
    from cuml.ensemble import RandomForestRegressor

    sys.path.insert(0, OUT)
    from benchmark import make_parcels  # reuse the exact generator for a like-for-like workload

    rng = np.random.default_rng(SEED)
    with nvtx.annotate("synthetic_generation", color="yellow"):
        frame = make_parcels(PARCELS, rng)
    features_host = np.column_stack([frame[key] for key in frame if key != "sale_price"]).astype("float32")
    target_host = frame["sale_price"].astype("float32")

    with nvtx.annotate("host_to_device", color="purple"):
        features = cupy.asarray(features_host)
        target = cupy.asarray(target_host)
    cupy.cuda.Stream.null.synchronize()

    model = RandomForestRegressor(n_estimators=40, max_depth=14, random_state=7)
    with nvtx.annotate("regression_fit", color="green"):
        model.fit(features, target)
    cupy.cuda.Stream.null.synchronize()

    with nvtx.annotate("regression_predict", color="orange"):
        raw_predictions = model.predict(features[:200000])  # device-resident result
    cupy.cuda.Stream.null.synchronize()

    with nvtx.annotate("device_to_host", color="purple"):
        # explicit device->host copy: np.asarray() on a CuPy array is refused by modern CuPy
        predictions = cupy.asnumpy(raw_predictions)

    kmeans = KMeans(n_clusters=24, n_init=4, random_state=7)
    with nvtx.annotate("clustering_fit", color="green"):
        kmeans.fit(features)
    cupy.cuda.Stream.null.synchronize()

    pca = PCA(n_components=8)
    with nvtx.annotate("pca_fit", color="green"):
        pca.fit(features)
    cupy.cuda.Stream.null.synchronize()

    rmse = float(np.sqrt(np.mean((np.asarray(predictions).ravel() - target_host[:200000]) ** 2)))
    free, total = cupy.cuda.runtime.memGetInfo()
    print(f"rows={PARCELS} rmse={rmse:.1f} free_vram_mb={free/1e6:.1f} total_vram_mb={total/1e6:.1f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
