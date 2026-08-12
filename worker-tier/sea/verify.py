"""Deterministic verification gate: syntax/compile checks and command-based tests.

The verifier is the objective truth the model is graded against — the model never self-reports
success. Checks are pluggable; Python compile + an optional test command cover the common case,
and `command_check` generalises to any language's build/test.
"""
from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass, field


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str = ""


@dataclass
class VerifyResult:
    ok: bool
    checks: list[CheckResult] = field(default_factory=list)

    def summary(self) -> str:
        bits = []
        for c in self.checks:
            tag = "ok" if c.ok else "FAIL"
            bits.append(f"{c.name}:{tag}" + (f" [{c.detail}]" if (not c.ok and c.detail) else ""))
        return "; ".join(bits) if bits else "no checks"


# In-memory syntax check: compile() validates the source WITHOUT writing __pycache__/*.pyc, so a
# rejected (later-rolled-back) edit never leaves stray bytecode behind. `python -m py_compile` would.
_COMPILE_SRC = "import sys; p = sys.argv[1]; compile(open(p, 'rb').read(), p, 'exec')"


def py_compile_check(root: str, files: list[str]) -> CheckResult:
    for f in files:
        if not f.endswith(".py"):
            continue
        r = subprocess.run(
            [sys.executable, "-B", "-c", _COMPILE_SRC, f],  # -B: never write bytecode
            cwd=root, capture_output=True, text=True,
        )
        if r.returncode != 0:
            return CheckResult("py_compile", False, r.stderr.strip()[-300:])
    return CheckResult("py_compile", True)


def command_check(name: str, cmd: str, root: str, timeout: int = 120) -> CheckResult:
    try:
        r = subprocess.run(cmd, shell=True, cwd=root, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return CheckResult(name, False, f"timeout after {timeout}s")
    detail = (r.stdout + r.stderr).strip()[-400:]
    return CheckResult(name, r.returncode == 0, detail)


class Verifier:
    def __init__(self, root: str, files: list[str], test_cmd: str | None = None,
                 compile_py: bool = True, test_timeout: int = 120):
        self.root = root
        self.files = files
        self.test_cmd = test_cmd
        self.compile_py = compile_py
        self.test_timeout = test_timeout

    def run(self) -> VerifyResult:
        checks: list[CheckResult] = []
        if self.compile_py:
            checks.append(py_compile_check(self.root, self.files))
        if self.test_cmd:
            checks.append(command_check("test", self.test_cmd, self.root, self.test_timeout))
        ok = all(c.ok for c in checks) if checks else True
        return VerifyResult(ok, checks)
