"""Sandboxed workspace: safe path resolution, atomic edit application, snapshot/rollback.

Every path is resolved under the workspace root and rejected if it escapes (defends against
`../` traversal and absolute paths). Edits apply all-or-nothing; on any failure the touched
files are restored from a pre-edit snapshot so the tree never lands in a half-edited state.
"""
from __future__ import annotations

from pathlib import Path

from .schema import Edit


class WorkspaceError(Exception):
    pass


class Workspace:
    def __init__(self, root: str):
        self.root = Path(root).resolve()
        if not self.root.is_dir():
            raise WorkspaceError(f"workspace root is not a directory: {self.root}")

    def _resolve(self, rel: str) -> Path:
        if rel != rel.strip() or rel == "":
            raise WorkspaceError(f"invalid path: {rel!r}")
        p = (self.root / rel).resolve()
        try:
            p.relative_to(self.root)
        except ValueError:
            raise WorkspaceError(f"path escapes workspace: {rel!r}")
        return p

    def read(self, rel: str) -> str:
        return self._resolve(rel).read_text()

    def exists(self, rel: str) -> bool:
        try:
            return self._resolve(rel).is_file()
        except WorkspaceError:
            return False

    def snapshot(self, rels: list[str]) -> dict[str, str | None]:
        snap: dict[str, str | None] = {}
        for r in rels:
            p = self._resolve(r)
            snap[r] = p.read_text() if p.is_file() else None
        return snap

    def restore(self, snap: dict[str, str | None]) -> None:
        errors: list[str] = []
        for r, content in snap.items():
            try:
                p = self._resolve(r)
                if content is None:
                    if p.is_file():
                        p.unlink()
                else:
                    p.write_text(content)
            except Exception as exc:  # noqa: BLE001 - attempt the entire snapshot before failing
                errors.append(f"{r}: {exc}")
        if errors:
            raise WorkspaceError(f"workspace restore failed: {'; '.join(errors)}")

    def apply_edit(self, e: Edit) -> tuple[bool, str]:
        p = self._resolve(e.file)
        if e.operation == "replace":
            if not p.is_file():
                return False, f"{e.file}: file does not exist for a replace edit"
            src = p.read_text()
            n = src.count(e.old_text or "")
            if n == 0:
                return False, f"{e.file}: old_text not found (must be a verbatim snippet)"
            if n > 1:
                return False, f"{e.file}: old_text is ambiguous (matches {n}x) — include more surrounding context"
            p.write_text(src.replace(e.old_text, e.new_text, 1))
            return True, f"{e.file}: replaced 1 occurrence"
        if e.operation == "rewrite":
            p.parent.mkdir(parents=True, exist_ok=True)
            content = e.content or ""
            p.write_text(content if content.endswith("\n") else content + "\n")
            return True, f"{e.file}: rewritten ({len(content)} bytes)"
        return False, f"{e.file}: unknown operation {e.operation!r}"

    def apply_edits(self, edits: list[Edit]) -> tuple[bool, list[str]]:
        """Apply a batch atomically: snapshot touched files, roll back on the first rejected edit OR
        on any raised exception (e.g. a filesystem error mid-write), so the tree is never left partial."""
        touched = list(dict.fromkeys(e.file for e in edits))
        try:
            snap = self.snapshot(touched)
        except Exception as exc:  # noqa: BLE001 - no writes may begin without a complete snapshot
            return False, [f"snapshot failed: {exc}"]
        msgs: list[str] = []
        try:
            for e in edits:
                ok, msg = self.apply_edit(e)
                msgs.append(msg)
                if not ok:
                    self.restore(snap)
                    return False, msgs
            return True, msgs
        except Exception as ex:  # noqa: BLE001 - any error mid-batch must still roll back cleanly
            try:
                self.restore(snap)
            except WorkspaceError as restore_error:
                raise WorkspaceError(
                    f"edit batch failed and workspace rollback was incomplete: {restore_error}"
                ) from restore_error
            msgs.append(f"exception during apply — rolled back (fail-closed): {ex}")
            return False, msgs
