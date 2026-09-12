#!/usr/bin/env python3
"""Cross-implementation parity: this adapter's trust gate vs the gate it references.

The adapter claims to implement `control-center/backend/workers.py#validate_preventive_trust_gate_v2`.
An earlier version of it did not: it required a prompt-injection boundary the referenced gate does not
recognize, and its path rule accepted strings the referenced gate rejects. That claim is only worth
something if it is checked, so this harness runs BOTH implementations over the same inputs and compares
the decision and the reason code.

Both gates must agree on every case, including denial. Exit 0 only if they do; write the matrix to
evidence/trust-gate-parity.json.

Run from the repository root:
    python scripts/execution-fabric/gpu-tabular-bench/trust_gate_parity.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BACKEND = os.path.join(REPO_ROOT, "control-center", "backend")
PROBE = os.path.join(HERE, "trust_gate_parity_probe.mjs")
EVIDENCE = os.path.join(HERE, "evidence", "trust-gate-parity.json")

sys.path.insert(0, BACKEND)
from workers import validate_preventive_trust_gate_v2  # noqa: E402

IDENTITY = {
    "workerId": "daedalus-gpu-tabular",
    "provider": "daedalus-cuml-rapids",
    "surface": "/home/daedalus/.venvs/cuml-qual",
    "attributable": True,
}

BASE_GATE = {
    "schemaVersion": 2,
    "workerIdentity": dict(IDENTITY),
    "rawCredentialInspection": False,
    "promptInjectionBoundary": "trusted-work-order-envelope-v1",
    "exactPathConfinement": True,
    "outputRedaction": True,
    "cancellation": {"supported": True},
    "independentEvidenceCapture": True,
}

BASE_PATHS = ["scripts/execution-fabric"]


def gate(**overrides) -> dict:
    merged = dict(BASE_GATE)
    merged.update(overrides)
    return merged


def paths(value, side: str = "both") -> dict:
    """Build the grant/scope pair; the referenced gate reads snake_case `allowed_paths`."""
    if side in ("both", "grant"):
        grant = {"allowed_paths": value}
    else:
        grant = {"allowed_paths": BASE_PATHS}
    if side in ("both", "scope"):
        scope = {"allowed_paths": value}
    else:
        scope = {"allowed_paths": BASE_PATHS}
    return {"grant": grant, "scope": scope}


CASES: list[tuple[str, dict, dict | None]] = [
    ("baseline passes", BASE_GATE, paths(BASE_PATHS)),
    ("gate missing", None, paths(BASE_PATHS)),
    ("schemaVersion wrong", gate(schemaVersion=1), paths(BASE_PATHS)),
    ("identity missing", gate(workerIdentity=None), paths(BASE_PATHS)),
    ("identity provider mismatch", gate(workerIdentity={**IDENTITY, "provider": "other"}), paths(BASE_PATHS)),
    ("identity not attributable", gate(workerIdentity={**IDENTITY, "attributable": False}), paths(BASE_PATHS)),
    ("rawCredentialInspection true", gate(rawCredentialInspection=True), paths(BASE_PATHS)),
    ("boundary unrecognized", gate(promptInjectionBoundary="provider-stdout-not-instructions"), paths(BASE_PATHS)),
    ("boundary trusted-work-order-envelope-v1", gate(promptInjectionBoundary="trusted-work-order-envelope-v1"), paths(BASE_PATHS)),
    ("exactPathConfinement false", gate(exactPathConfinement=False), paths(BASE_PATHS)),
    ("outputRedaction false", gate(outputRedaction=False), paths(BASE_PATHS)),
    ("cancellation unsupported", gate(cancellation={"supported": False}), paths(BASE_PATHS)),
    ("cancellation missing", gate(cancellation=None), paths(BASE_PATHS)),
    ("independentEvidenceCapture false", gate(independentEvidenceCapture=False), paths(BASE_PATHS)),
    ("authority missing", BASE_GATE, None),
    ("grant paths missing", BASE_GATE, {"scope": {"allowed_paths": BASE_PATHS}}),
    ("grant/scope mismatch", BASE_GATE, {"grant": {"allowed_paths": ["scripts/a"]},
                                         "scope": {"allowed_paths": ["scripts/b"]}}),
    ("duplicate paths", BASE_GATE, paths(["a", "a"])),
    ("empty path list", BASE_GATE, paths([])),
    ("absolute path", BASE_GATE, paths(["/etc"])),
    ("drive-letter path", BASE_GATE, paths(["C:/drive"])),
    ("traversal path", BASE_GATE, paths(["../escape"])),
    ("dot segment", BASE_GATE, paths(["foo/./bar"])),
    ("double separator", BASE_GATE, paths(["a/b//c"])),
    ("question mark", BASE_GATE, paths(["sc?ripts"])),
    ("square brackets", BASE_GATE, paths(["we[i]rd"])),
    ("colon in first segment", BASE_GATE, paths(["foo:bar"])),
    ("wildcard", BASE_GATE, paths(["scripts/*"])),
    ("empty string path", BASE_GATE, paths([""])),
    ("nesting accepted", BASE_GATE, paths(["a/b/c"])),
    ("backslash normalized", BASE_GATE, paths(["a\\b"])),
]


def adapter_decision(gate_value: dict | None, authority: dict | None) -> dict:
    payload = json.dumps({"gate": gate_value, "authority": authority})
    last = None
    for _attempt in range(2):  # one retry: node startup can transiently fail under heavy parallel load
        proc = subprocess.run(
            ["node", PROBE],
            input=payload, capture_output=True, text=True, encoding="utf-8", check=False,
        )
        if proc.returncode == 0:
            return json.loads(proc.stdout)
        last = proc
    raise RuntimeError(f"adapter probe failed: {last.stderr.strip()[:400]}")


def python_decision(gate_value: dict | None, authority: dict | None) -> dict:
    worker = {"id": IDENTITY["workerId"], "preventive_trust_gate_v2": gate_value}
    grant = (authority or {}).get("grant")
    scope = (authority or {}).get("scope")
    return validate_preventive_trust_gate_v2(worker, grant, scope)


# The adapter pins provider and surface to the reviewed DAEDALUS binding. The general gate compares only
# the selected worker id (in a real dispatch the caller has already selected the worker), so this is a
# deliberate ADDITIONAL restriction, not a divergence. Every expected difference must be listed here:
# the harness fails on any other difference, and fails outright on any case where the adapter is more
# permissive than the gate it claims to implement.
EXPECTED_STRICTER = {
    "identity provider mismatch": (
        "the adapter pins provider+surface to the reviewed binding; the referenced gate compares only "
        "the selected worker id"
    ),
}


def main() -> int:
    rows = []
    failures = []
    stricter_documented = []
    for label, gate_value, authority in CASES:
        py = python_decision(gate_value, authority)
        js = adapter_decision(gate_value, authority)
        py_pair = (bool(py.get("allowed")), py.get("reason_code"))
        js_pair = (bool(js.get("allowed")), js.get("reasonCode"))

        if py_pair == js_pair:
            verdict = "agree"
        elif js_pair[0]:
            verdict = "adapter_more_permissive"
            failures.append(f"{label}: adapter allowed what the reference denied ({js_pair} vs {py_pair})")
        else:
            verdict = "adapter_stricter"
            if label in EXPECTED_STRICTER:
                stricter_documented.append({"case": label, "reason": EXPECTED_STRICTER[label]})
            else:
                failures.append(f"{label}: undocumented stricter denial ({js_pair} vs {py_pair})")

        rows.append({
            "case": label,
            "python": {"allowed": py_pair[0], "reasonCode": py_pair[1]},
            "adapter": {"allowed": js_pair[0], "reasonCode": js_pair[1]},
            "verdict": verdict,
        })

    outcome = {
        "schemaVersion": "williamos-gpu-tabular-trust-gate-parity/1",
        "promoted": False,
        "referenceImplementation": "control-center/backend/workers.py#validate_preventive_trust_gate_v2",
        "adapterImplementation": "scripts/execution-fabric/gpu-tabular-capability.mjs#assertPreventiveTrustGateV2",
        "cases": len(rows),
        "agreeing": sum(1 for row in rows if row["verdict"] == "agree"),
        "stricter": stricter_documented,
        "failures": failures,
        "ok": not failures,
        "matrix": rows,
    }
    os.makedirs(os.path.dirname(EVIDENCE), exist_ok=True)
    with open(EVIDENCE, "w", encoding="utf-8") as handle:
        json.dump(outcome, handle, indent=2)
        handle.write("\n")

    for row in rows:
        mark = {"agree": "ok  ", "adapter_stricter": "STRICT", "adapter_more_permissive": "UNSAFE"}[row["verdict"]]
        print(f"  [{mark}] {row['case']:42s} python={row['python']['reasonCode']}"
              f" adapter={row['adapter']['reasonCode']}")
    print(f"\n{len(rows)} cases: {outcome['agreeing']} agree, "
          f"{len(stricter_documented)} documented stricter, {len(failures)} failures")
    for line in failures:
        print(f"  FAILURE {line}")
    if failures:
        return 1
    print("adapter never allows what the referenced gate denies, and every difference is documented")
    return 0


if __name__ == "__main__":
    sys.exit(main())
