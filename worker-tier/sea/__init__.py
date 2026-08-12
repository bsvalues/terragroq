"""SEA — Structured-Edit Adapter tier for small/local coding models.

Addresses the Pilot-0 finding: on a 64K-compliant local 8B model, free-form agentic
tool-calling is unreliable, but the model's *reasoning* is adequate when it only has to
emit strict structured JSON that a deterministic adapter validates, applies, and verifies.

Public API:
    from sea import Workspace, Verifier, ModelClient, worker, review, remediate
"""
from .workspace import Workspace, WorkspaceError
from .verify import Verifier, VerifyResult, CheckResult
from .model import ModelClient, MockModelClient, ModelError
from .schema import Edit, Verdict, parse_edits, parse_verdict
from .roles import worker, review, remediate, RoleResult

__all__ = [
    "Workspace", "WorkspaceError",
    "Verifier", "VerifyResult", "CheckResult",
    "ModelClient", "MockModelClient", "ModelError",
    "Edit", "Verdict", "parse_edits", "parse_verdict",
    "worker", "review", "remediate", "RoleResult",
]
__version__ = "0.1.0"
