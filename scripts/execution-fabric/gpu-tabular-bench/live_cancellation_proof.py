#!/usr/bin/env python3
"""Live proof that cancellation stops real accelerator work, and that recovery does not duplicate it.

Runs ON the accelerator host, inside the isolated qualification environment. This is not a fixture: it
starts a real cuML job on the real device, cancels it mid-fit, and checks the device and the filesystem
afterwards. Synthetic data only - no county or protected records are read.

The three questions it answers, each with an observable answer:

  1. Does cancellation actually stop accelerator work?
     The child is cancelled while fitting. Afterwards the process must be gone AND the device must be
     free (no residual compute context holding memory).
  2. Does a cancelled run leave a partial effect?
     The workload writes its artifact only on successful completion, so a cancelled run must leave no
     artifact behind. A cancellation that still produces a result is not a cancellation.
  3. Does recovery duplicate the effect?
     A clean run after the cancellation writes exactly one artifact, and a replay rewrites that same
     single artifact rather than adding a second one.

Exit code is 0 only if every check passes; the JSON result is written next to this script's log.
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
EVIDENCE_DIR = os.path.join(HERE, "evidence")
CANCELLATION_ARTIFACT = os.path.join(EVIDENCE_DIR, "live-cancellation-proof.json")
CANCELLED_OUTPUT = os.path.join(EVIDENCE_DIR, "live-cancelled-run-output.json")
RECOVERY_OUTPUT = os.path.join(EVIDENCE_DIR, "live-recovery-run-output.json")

# The cancellation must land while the accelerator is genuinely busy, so the workload is sized to run
# for a measurable interval rather than finishing before the signal arrives.
WORKLOAD_ROWS = 400_000
CANCEL_AFTER_SECONDS = 6.0

WORKER_SOURCE = r'''
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from cuml.ensemble import RandomForestRegressor

rows = int(sys.argv[1])
output_path = sys.argv[2]
marker_path = sys.argv[3]

rng = np.random.default_rng(7)
features = rng.normal(size=(rows, 12)).astype("float32")
target = (features @ rng.normal(size=12)).astype("float32")

# The marker proves the accelerator phase actually started, so a cancellation that lands here is a
# cancellation of real device work rather than of process startup.
open(marker_path, "w").write("fitting")

model = RandomForestRegressor(n_estimators=200, max_depth=16, random_state=7)
model.fit(features, target)

# The artifact is written only on success. A cancelled run therefore leaves nothing behind.
with open(output_path, "w") as handle:
    json.dump({"rows": rows, "completed": True, "artifactWrites": 1}, handle)
print("WORKER_COMPLETED")
'''


def _sha256(path: str) -> str:
    import hashlib

    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def query_compute_apps():
    """Return (query_succeeded, rows). A failed query is NOT evidence that the device is free."""
    try:
        smi = subprocess.run(
            ["nvidia-smi", "--query-compute-apps=pid,used_memory", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=30,
        )
    except Exception as exc:  # noqa: BLE001 - any failure means we cannot prove the device state
        return False, [f"QUERY_ERROR:{exc}"]
    if smi.returncode != 0:
        return False, [f"QUERY_ERROR:exit={smi.returncode}"]
    return True, [line.strip() for line in smi.stdout.splitlines() if line.strip()]


def run_checks() -> dict:
    worker_path = os.path.join(HERE, "live_cancellation_worker.py")
    with open(worker_path, "w") as handle:
        handle.write(WORKER_SOURCE)

    import importlib.util

    spec = importlib.util.find_spec("cuml")
    if spec is None:
        return {"ok": False, "detail": "cuml is not importable in this environment"}

    for path in (CANCELLED_OUTPUT, RECOVERY_OUTPUT):
        if os.path.exists(path):
            os.remove(path)

    result: dict = {
        "schemaVersion": "williamos-gpu-tabular-live-cancellation/1",
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "host": os.uname().nodename,
        "workloadRows": WORKLOAD_ROWS,
        "syntheticDataOnly": True,
        # An evidence artifact never asserts its own promotion; the verifier rejects it if it does.
        "promoted": False,
        "checks": {},
    }

    # --- check 1 + 2: cancel real accelerator work, and prove no partial effect -------------------
    marker = os.path.join(EVIDENCE_DIR, "live-cancelled-run-marker")
    if os.path.exists(marker):
        os.remove(marker)
    child = subprocess.Popen(
        [sys.executable, worker_path, str(WORKLOAD_ROWS), CANCELLED_OUTPUT, marker],
        start_new_session=True,  # own process group, so cancellation reaches the whole job
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    started = time.time()
    while time.time() - started < CANCEL_AFTER_SECONDS:
        if os.path.exists(marker) or child.poll() is not None:
            break
        time.sleep(0.2)
    accelerator_phase_started = os.path.exists(marker)
    time.sleep(1.0)

    was_running = child.poll() is None

    # Prove the child actually held the device BEFORE cancelling. The marker alone only shows the
    # process reached the fit call; the compute-apps query shows the device was in use by that PID.
    inflight_ok, inflight_rows = query_compute_apps()
    held_device = inflight_ok and any(row.split(",")[0].strip() == str(child.pid) for row in inflight_rows)

    os.killpg(os.getpgid(child.pid), signal.SIGTERM)
    try:
        child.wait(timeout=20)
    except subprocess.TimeoutExpired:
        os.killpg(os.getpgid(child.pid), signal.SIGKILL)
        child.wait(timeout=10)
    cancelled_after = None
    for _ in range(50):
        if child.poll() is not None:
            cancelled_after = child.poll()
            break
        time.sleep(0.2)
    still_alive = child.poll() is None

    result["checks"]["acceleratorPhaseObservedBeforeCancel"] = accelerator_phase_started
    result["checks"]["deviceHeldByWorkerBeforeCancel"] = held_device
    result["checks"]["inflightDeviceRows"] = inflight_rows
    result["checks"]["wasActivelyRunningWhenCancelled"] = was_running
    result["checks"]["processGoneAfterCancel"] = not still_alive
    result["checks"]["cancelledExitCode"] = cancelled_after
    result["checks"]["noArtifactFromCancelledRun"] = not os.path.exists(CANCELLED_OUTPUT)

    # The device must be free afterwards - and the query must have SUCCEEDED for that to mean anything.
    # A failed nvidia-smi returns empty stdout, which the earlier version read as "released".
    released_ok, residual = query_compute_apps()
    result["checks"]["deviceComputeProcessesAfterCancel"] = residual
    result["checks"]["deviceQuerySucceeded"] = released_ok
    result["checks"]["deviceReleased"] = released_ok and len(residual) == 0

    # --- check 3: a clean run produces one artifact; a replay does not add a second -----------------
    clean = subprocess.run(
        [sys.executable, worker_path, str(WORKLOAD_ROWS), RECOVERY_OUTPUT, marker],
        capture_output=True, text=True, timeout=1800,
    )
    result["checks"]["recoveryRunCompleted"] = clean.returncode == 0 and "WORKER_COMPLETED" in clean.stdout
    result["checks"]["recoveryArtifactPresent"] = os.path.exists(RECOVERY_OUTPUT)

    family = "live-recovery-run-output"
    replay_files_before = len([name for name in os.listdir(EVIDENCE_DIR) if name.startswith(family)])
    hash_before = _sha256(RECOVERY_OUTPUT) if os.path.exists(RECOVERY_OUTPUT) else None

    replay = subprocess.run(
        [sys.executable, worker_path, str(WORKLOAD_ROWS), RECOVERY_OUTPUT, marker],
        capture_output=True, text=True, timeout=1800,
    )
    result["checks"]["replayCompleted"] = replay.returncode == 0

    # The earlier version counted entries equal to a fixed basename, which is 1 by construction and
    # therefore could not fail. Count the artifact family before and after the replay instead, and
    # compare content: the replay must not add a second artifact, and it must produce the same result.
    family = "live-recovery-run-output"
    after_files = sorted(name for name in os.listdir(EVIDENCE_DIR) if name.startswith(family))
    hash_after = _sha256(RECOVERY_OUTPUT) if os.path.exists(RECOVERY_OUTPUT) else None
    result["checks"]["replayArtifactFilesBefore"] = replay_files_before
    result["checks"]["replayArtifactFilesAfter"] = len(after_files)
    result["checks"]["replayDidNotAddArtifact"] = len(after_files) == replay_files_before == 1
    result["checks"]["replayReproducedSameResult"] = (
        hash_after is not None and hash_before is not None and hash_after == hash_before
    )

    # The post-check cosmetic mutation of the artifact is gone: it rewrote the file after the checks
    # had been taken and added nothing but confusion.

    required = [
        "acceleratorPhaseObservedBeforeCancel",
        "deviceHeldByWorkerBeforeCancel",
        "wasActivelyRunningWhenCancelled",
        "processGoneAfterCancel",
        "noArtifactFromCancelledRun",
        "deviceQuerySucceeded",
        "deviceReleased",
        "recoveryRunCompleted",
        "recoveryArtifactPresent",
        "replayCompleted",
        "replayDidNotAddArtifact",
        "replayReproducedSameResult",
    ]
    result["ok"] = all(result["checks"].get(key) is True for key in required)
    if os.path.exists(marker):
        os.remove(marker)
    return result


if __name__ == "__main__":
    outcome = run_checks()
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    with open(CANCELLATION_ARTIFACT, "w") as handle:
        json.dump(outcome, handle, indent=2)
        handle.write("\n")
    print(json.dumps(outcome, indent=2))
    sys.exit(0 if outcome.get("ok") else 1)
