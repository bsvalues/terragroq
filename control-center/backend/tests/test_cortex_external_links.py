"""cortex-map must not crash when a note cites an external URL.

`_add_link_edges` adds `external_link` nodes to the very dict it iterates, so a
plain `nodes.items()` view raised `RuntimeError: dictionary changed size during
iteration` as soon as any note contained an `http(s)` markdown link. The live
vault happened to have zero external links, so the defect was latent until a
note cited a source.
"""

import sys
from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parents[3]
_SCRIPTS = str(_REPO / "scripts")
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

import williamos_cortex as cortex  # noqa: E402


@pytest.fixture()
def vault(tmp_path, monkeypatch):
    monkeypatch.setattr(cortex, "VAULT", tmp_path)
    return tmp_path


def _note(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"---\ntype: note\n---\n\n{body}\n", encoding="utf-8")


def test_external_link_does_not_crash_graph_build(vault):
    _note(vault / "07_Learning" / "Cites A Source.md",
          "See [the spec](https://example.com/spec) for detail.")
    _note(vault / "07_Learning" / "Plain.md", "No links here.")

    notes = [{"path": p, "rel": str(p.relative_to(vault)).replace("\\", "/")}
             for p in (vault / "07_Learning").glob("*.md")]
    graph = cortex.build_graph(notes)

    ext = [k for k in graph["nodes"] if k.startswith("ext:")]
    assert len(ext) == 1
    assert graph["nodes"][ext[0]]["type"] == "external_link"
    # the citing note must be connected to the external node
    assert any(e["target"] == ext[0] and e["type"] == "markdown_link"
               for e in graph["edges"])


def test_many_external_links_across_many_notes(vault):
    for i in range(5):
        _note(vault / "07_Learning" / f"Note {i}.md",
              f"Source: [ref {i}](https://example.com/{i}) and "
              f"[other](https://other.example/{i}).")

    notes = [{"path": p, "rel": str(p.relative_to(vault)).replace("\\", "/")}
             for p in (vault / "07_Learning").glob("*.md")]
    graph = cortex.build_graph(notes)

    ext = [k for k in graph["nodes"] if k.startswith("ext:")]
    assert len(ext) == 10


def test_no_external_links_still_builds(vault):
    _note(vault / "07_Learning" / "Internal.md", "Links to [[Other]].")

    notes = [{"path": p, "rel": str(p.relative_to(vault)).replace("\\", "/")}
             for p in (vault / "07_Learning").glob("*.md")]
    graph = cortex.build_graph(notes)

    assert not [k for k in graph["nodes"] if k.startswith("ext:")]
    assert len(graph["edges"]) >= 1
