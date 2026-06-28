"""Read-only external agent/tool configuration inventory.

Phase 5J first slice discovers known configuration surfaces by path presence
and risk class only. It does not read secrets, mutate configs, switch providers,
or enable workers.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
HOME = Path.home()


@dataclass(frozen=True)
class ConfigLocation:
    path: str
    exists: bool
    kind: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class AgentConfigSurface:
    surface_id: str
    label: str
    category: str
    status: str
    risk_level: str
    locations: list[ConfigLocation]
    secrets_redacted: bool
    notes: list[str]
    flags: list[str]
    authority: str

    def to_dict(self) -> dict[str, Any]:
        row = asdict(self)
        row["locations"] = [location.to_dict() for location in self.locations]
        return row


def _location(path: Path, kind: str = "path") -> ConfigLocation:
    return ConfigLocation(path=str(path), exists=path.exists(), kind=kind)


def _repo_file(name: str) -> ConfigLocation:
    return _location(REPO_ROOT / name, "repo-file")


def _home_path(name: str, kind: str = "user-config") -> ConfigLocation:
    return _location(HOME / name, kind)


def _tmp_claude_files() -> int:
    try:
        return len(list(HOME.glob(".claude.json.tmp.*")))
    except OSError:
        return 0


def _surface_status(locations: list[ConfigLocation]) -> str:
    return "detected" if any(location.exists for location in locations) else "not-found"


def _surface(
    surface_id: str,
    label: str,
    category: str,
    risk_level: str,
    locations: list[ConfigLocation],
    notes: list[str],
    flags: list[str] | None = None,
    authority: str = "read-only-inventory",
) -> AgentConfigSurface:
    return AgentConfigSurface(
        surface_id=surface_id,
        label=label,
        category=category,
        status=_surface_status(locations),
        risk_level=risk_level,
        locations=locations,
        secrets_redacted=True,
        notes=notes,
        flags=flags or [],
        authority=authority,
    )


def _seed_surfaces() -> list[AgentConfigSurface]:
    claude_tmp_count = _tmp_claude_files()
    return [
        _surface(
            "claude-code",
            "Claude Code",
            "external-worker",
            "review",
            [_home_path(".claude"), _home_path(".claude.json", "user-config-file")],
            [
                "Detected by path presence only.",
                "Secrets and provider fields are not read or displayed.",
            ],
            flags=["tmp-config-files-present"] if claude_tmp_count else [],
        ),
        _surface(
            "codex",
            "Codex",
            "external-worker",
            "managed",
            [_home_path(".codex"), _home_path(".codex-worktrees")],
            [
                "Detected by path presence only.",
                "Current WilliamOS authority remains local and operator-gated.",
            ],
        ),
        _surface(
            "hermes",
            "Hermes",
            "external-worker",
            "unknown",
            [_home_path(".hermes")],
            ["Unknown worker config surface; inventory only until classified."],
            flags=["unknown-config-surface"],
        ),
        _surface(
            "opencode",
            "OpenCode",
            "external-worker",
            "unknown",
            [_home_path(".opencode")],
            ["Not detected in the first slice unless path exists; no import performed."],
            flags=["unknown-config-surface"],
        ),
        _surface(
            "openclaw",
            "OpenClaw",
            "external-worker",
            "unknown",
            [_home_path(".openclaw")],
            ["Unknown worker config surface; inventory only until classified."],
            flags=["unknown-config-surface"],
        ),
        _surface(
            "cc-switch",
            "CC Switch",
            "provider-switching",
            "high",
            [_home_path(".cc-switch"), _home_path("cc-switch")],
            ["Provider switching surfaces are high-risk and disabled unless explicitly approved."],
            flags=["provider-switching-risk"],
        ),
        _surface(
            "mcp-servers",
            "MCP Servers",
            "tooling",
            "review",
            [_home_path(".codex"), _home_path(".claude"), _repo_file(".mcp.json")],
            ["MCP configuration may include tool authority; secrets are redacted by default."],
            flags=["tool-authority-review"],
        ),
        _surface(
            "agents-md",
            "AGENTS.md",
            "repo-instructions",
            "managed",
            [_repo_file("AGENTS.md")],
            ["Repository-level agent instructions, if present."],
        ),
        _surface(
            "claude-md",
            "CLAUDE.md",
            "repo-instructions",
            "review",
            [_repo_file("CLAUDE.md")],
            ["Claude-specific repository instructions, if present."],
        ),
        _surface(
            "gemini-md",
            "GEMINI.md",
            "repo-instructions",
            "review",
            [_repo_file("GEMINI.md")],
            ["Gemini-specific repository instructions, if present."],
        ),
        _surface(
            "skills",
            "Skills",
            "capability-registry",
            "review",
            [_home_path(".codex/skills"), _home_path(".agents/skills"), _home_path(".codex/plugins/cache")],
            ["Skill bundles are detected by directory presence only; contents are not imported."],
            flags=["capability-surface"],
        ),
        _surface(
            "provider-configs",
            "Provider Configs",
            "provider-credentials",
            "high",
            [_home_path(".claude.json", "user-config-file"), _home_path(".codex"), _home_path(".hermes")],
            ["Provider configs may contain credentials or cloud endpoints; values are never displayed."],
            flags=["secret-risk", "cloud-provider-review"],
        ),
        _surface(
            "local-model-runtimes",
            "Local Model Runtimes",
            "model-runtime",
            "managed",
            [_home_path(".ollama"), _home_path("AppData/Local/Programs/Ollama"), _home_path(".lmstudio")],
            ["Local runtime inventory only; no provider switch or fallback behavior is changed."],
        ),
    ]


def list_config_surfaces(status: str | None = None) -> list[dict[str, Any]]:
    rows = [surface.to_dict() for surface in _seed_surfaces()]
    if status:
        rows = [row for row in rows if row["status"] == status]
    return rows


def get_config_surface(surface_id: str) -> dict[str, Any] | None:
    needle = surface_id.strip().lower()
    for surface in _seed_surfaces():
        if surface.surface_id.lower() == needle:
            return surface.to_dict()
    return None


def search_config_surfaces(query: str) -> list[dict[str, Any]]:
    needle = query.strip().lower()
    if not needle:
        return list_config_surfaces()
    result = []
    for row in list_config_surfaces():
        haystack = " ".join(
            [
                row["surface_id"],
                row["label"],
                row["category"],
                row["status"],
                row["risk_level"],
                row["authority"],
                " ".join(row["notes"]),
                " ".join(row["flags"]),
                " ".join(location["path"] for location in row["locations"]),
            ]
        ).lower()
        if needle in haystack:
            result.append(row)
    return result
