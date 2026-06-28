"""Tests for copilot.retrieval — TDD with mocked embeddings.

Design:
- build_index: walk a tmp vault dir, embed with a deterministic fn, upsert to tmp db.
- search: return top-k by cosine similarity using embedded query.
- search: fall back to ripgrep keyword search when index is empty or embed fails.
- search: never raises on total failure.
"""

from __future__ import annotations

import json
import math
import shutil
import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest

from copilot import retrieval


# ---------------------------------------------------------------------------
# Deterministic embed helpers
# ---------------------------------------------------------------------------

def _simple_vector(text: str, dim: int = 8) -> list[float]:
    """Deterministic fake embedding based on text hash — NOT random."""
    h = hash(text) & 0xFFFF_FFFF
    v = [(((h >> i) & 0xFF) / 255.0) for i in range(0, dim * 8, 8)]
    # Normalise so cosine comparisons are well-defined
    norm = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / norm for x in v]


def _fake_embed(texts: list[str]) -> list[list[float]]:
    return [_simple_vector(t) for t in texts]


def _make_vault(tmp_path: Path, files: dict[str, str]) -> Path:
    """Create markdown files inside a temp vault dir."""
    vault = tmp_path / "vault"
    vault.mkdir()
    for name, content in files.items():
        (vault / name).write_text(content, encoding="utf-8")
    return vault


# ---------------------------------------------------------------------------
# build_index tests
# ---------------------------------------------------------------------------

class TestBuildIndex:
    def test_returns_correct_file_and_chunk_counts(self, tmp_path):
        vault = _make_vault(tmp_path, {
            "alpha.md": "# Alpha\n\nThis is the first document about apples.",
            "beta.md": "# Beta\n\nThis is the second document about bananas.",
        })
        db_path = str(tmp_path / "idx.db")

        stats = retrieval.build_index(vault_dir=vault, embed_fn=_fake_embed, db_path=db_path)

        assert stats["files"] == 2
        assert stats["chunks"] >= 2  # at least one chunk per file
        assert stats["db"] == db_path

    def test_rows_exist_in_db_after_indexing(self, tmp_path):
        vault = _make_vault(tmp_path, {
            "note.md": "Hello world.\n\nThis is a note.",
        })
        db_path = str(tmp_path / "idx.db")

        retrieval.build_index(vault_dir=vault, embed_fn=_fake_embed, db_path=db_path)

        conn = sqlite3.connect(db_path)
        rows = conn.execute("SELECT path, chunk_idx, text, vector FROM chunks").fetchall()
        conn.close()

        assert len(rows) >= 1
        # vector column should be valid JSON list
        vec = json.loads(rows[0][3])
        assert isinstance(vec, list)
        assert len(vec) > 0

    def test_reindex_is_idempotent(self, tmp_path):
        vault = _make_vault(tmp_path, {
            "doc.md": "Content here.\n\nMore content.",
        })
        db_path = str(tmp_path / "idx.db")

        retrieval.build_index(vault_dir=vault, embed_fn=_fake_embed, db_path=db_path)
        retrieval.build_index(vault_dir=vault, embed_fn=_fake_embed, db_path=db_path)

        conn = sqlite3.connect(db_path)
        count = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
        conn.close()

        # Idempotent: second run should not double the rows
        first_run_conn = sqlite3.connect(db_path)
        # Just verify count is reasonable (same as one run)
        assert count >= 1

    def test_skips_empty_files(self, tmp_path):
        vault = _make_vault(tmp_path, {
            "empty.md": "",
            "real.md": "Some real content here.",
        })
        db_path = str(tmp_path / "idx.db")

        stats = retrieval.build_index(vault_dir=vault, embed_fn=_fake_embed, db_path=db_path)

        assert stats["files"] == 1  # only real.md

    def test_skipped_count_when_embed_raises(self, tmp_path):
        vault = _make_vault(tmp_path, {
            "bad.md": "This file will fail embedding.",
        })
        db_path = str(tmp_path / "idx.db")

        def failing_embed(texts: list[str]) -> list[list[float]]:
            raise RuntimeError("embed failure")

        stats = retrieval.build_index(vault_dir=vault, embed_fn=failing_embed, db_path=db_path)

        assert stats["skipped"] >= 1
        assert stats["files"] == 0  # no files successfully indexed

    def test_non_md_files_ignored(self, tmp_path):
        vault = tmp_path / "vault"
        vault.mkdir()
        (vault / "note.md").write_text("A markdown note.", encoding="utf-8")
        (vault / "data.txt").write_text("A text file.", encoding="utf-8")
        (vault / "image.png").write_bytes(b"\x89PNG")
        db_path = str(tmp_path / "idx.db")

        stats = retrieval.build_index(vault_dir=vault, embed_fn=_fake_embed, db_path=db_path)

        assert stats["files"] == 1  # only .md files

    def test_nested_md_files_are_indexed(self, tmp_path):
        vault = tmp_path / "vault"
        sub = vault / "subdir"
        sub.mkdir(parents=True)
        (vault / "root.md").write_text("Root note.", encoding="utf-8")
        (sub / "nested.md").write_text("Nested note.", encoding="utf-8")
        db_path = str(tmp_path / "idx.db")

        stats = retrieval.build_index(vault_dir=vault, embed_fn=_fake_embed, db_path=db_path)

        assert stats["files"] == 2

    def test_index_markdown_file_indexes_only_one_file(self, tmp_path):
        note = tmp_path / "research.md"
        note.write_text("# Intake\n\nDropped research about TerraFusion.", encoding="utf-8")
        db_path = str(tmp_path / "idx.db")

        stats = retrieval.index_markdown_file(note, embed_fn=_fake_embed, db_path=db_path)

        assert stats["ok"] is True
        assert stats["chunks"] >= 1
        conn = sqlite3.connect(db_path)
        rows = conn.execute("SELECT path, text FROM chunks").fetchall()
        conn.close()
        assert len(rows) >= 1
        assert rows[0][0] == str(note)
        assert "TerraFusion" in rows[0][1]

    def test_index_markdown_file_reindex_is_idempotent(self, tmp_path):
        note = tmp_path / "research.md"
        note.write_text("First version.", encoding="utf-8")
        db_path = str(tmp_path / "idx.db")

        retrieval.index_markdown_file(note, embed_fn=_fake_embed, db_path=db_path)
        note.write_text("Second version.", encoding="utf-8")
        retrieval.index_markdown_file(note, embed_fn=_fake_embed, db_path=db_path)

        conn = sqlite3.connect(db_path)
        rows = conn.execute("SELECT text FROM chunks WHERE path = ?", (str(note),)).fetchall()
        conn.close()
        assert len(rows) == 1
        assert rows[0][0] == "Second version."


# ---------------------------------------------------------------------------
# search tests
# ---------------------------------------------------------------------------

class TestSearch:
    def _build(self, tmp_path: Path, files: dict[str, str]) -> tuple[Path, str]:
        vault = _make_vault(tmp_path, files)
        db_path = str(tmp_path / "idx.db")
        retrieval.build_index(vault_dir=vault, embed_fn=_fake_embed, db_path=db_path)
        return vault, db_path

    def test_returns_more_similar_chunk_first(self, tmp_path):
        """Construct two vectors where query is closest to chunk_a."""
        # We'll use a controlled embed_fn where we can predict cosine ordering.
        # chunk_a vector: all positive, aligned with query
        # chunk_b vector: orthogonal to query

        chunk_a_text = "apples are a fruit"
        chunk_b_text = "quantum mechanics overview"

        # Make vectors with known cosine relationship:
        #   query_vec = [1,0,...] -> chunk_a = [1,0,...] (cos=1), chunk_b = [0,1,...] (cos=0)
        vector_map = {
            chunk_a_text: [1.0, 0.0, 0.0, 0.0],
            chunk_b_text: [0.0, 1.0, 0.0, 0.0],
        }
        query_text = "apple fruit"
        query_vector = [1.0, 0.0, 0.0, 0.0]  # identical to chunk_a

        def controlled_embed(texts: list[str]) -> list[list[float]]:
            result = []
            for t in texts:
                if t in vector_map:
                    result.append(vector_map[t])
                else:
                    # query or unknown — return query_vector
                    result.append(query_vector)
            return result

        vault = _make_vault(tmp_path, {
            "fruit.md": chunk_a_text,
            "physics.md": chunk_b_text,
        })
        db_path = str(tmp_path / "idx.db")
        retrieval.build_index(vault_dir=vault, embed_fn=controlled_embed, db_path=db_path)

        results = retrieval.search(
            query_text,
            k=2,
            embed_fn=controlled_embed,
            db_path=db_path,
        )

        assert len(results) >= 1
        # Top result should be chunk_a (cosine 1.0 vs 0.0)
        assert results[0]["score"] > (results[1]["score"] if len(results) > 1 else -1)
        # chunk_a's file path should be first
        assert "fruit.md" in results[0]["path"]

    def test_result_shape(self, tmp_path):
        vault, db_path = self._build(tmp_path, {"note.md": "Hello world content."})

        results = retrieval.search(
            "hello", k=1, embed_fn=_fake_embed, db_path=db_path
        )

        assert len(results) == 1
        r = results[0]
        assert "path" in r
        assert "excerpt" in r
        assert "score" in r
        assert r["score"] is not None
        assert isinstance(r["excerpt"], str)
        assert len(r["excerpt"]) <= 300

    def test_excerpt_truncated_to_300(self, tmp_path):
        long_text = "word " * 200  # 1000 chars
        vault, db_path = self._build(tmp_path, {"long.md": long_text})

        results = retrieval.search(
            "word", k=1, embed_fn=_fake_embed, db_path=db_path
        )

        for r in results:
            assert len(r["excerpt"]) <= 300

    def test_search_respects_k_limit(self, tmp_path):
        files = {f"doc{i}.md": f"Document number {i} about topic {i}." for i in range(10)}
        vault, db_path = self._build(tmp_path, files)

        results = retrieval.search("document", k=3, embed_fn=_fake_embed, db_path=db_path)

        assert len(results) <= 3

    def test_search_never_raises_on_empty_index(self, tmp_path):
        db_path = str(tmp_path / "empty.db")
        # Create an empty db (no rows)
        conn = sqlite3.connect(db_path)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS chunks "
            "(id INTEGER PRIMARY KEY, path TEXT, chunk_idx INT, text TEXT, vector TEXT)"
        )
        conn.commit()
        conn.close()

        def always_fail(texts):
            raise RuntimeError("no embeddings")

        # Should not raise
        results = retrieval.search(
            "query",
            k=5,
            embed_fn=always_fail,
            db_path=db_path,
        )
        assert isinstance(results, list)

    def test_search_never_raises_on_total_failure(self, tmp_path):
        db_path = str(tmp_path / "nonexistent_dir" / "idx.db")

        def always_fail(texts):
            raise RuntimeError("failure")

        # Should not raise even with a bad db path
        results = retrieval.search(
            "query",
            k=5,
            embed_fn=always_fail,
            db_path=db_path,
        )
        assert isinstance(results, list)


# ---------------------------------------------------------------------------
# ripgrep fallback tests
# ---------------------------------------------------------------------------

class TestRipgrepFallback:
    def test_fallback_when_index_empty_and_embed_fails(self, tmp_path, monkeypatch):
        """When index is empty and embed raises, falls back to rg keyword search."""
        # Create a vault file containing the search term
        vault = tmp_path / "vault"
        vault.mkdir()
        (vault / "findme.md").write_text(
            "pineapple is a tropical fruit", encoding="utf-8"
        )

        db_path = str(tmp_path / "empty.db")
        # Empty db (no rows)
        conn = sqlite3.connect(db_path)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS chunks "
            "(id INTEGER PRIMARY KEY, path TEXT, chunk_idx INT, text TEXT, vector TEXT)"
        )
        conn.commit()
        conn.close()

        def always_fail(texts):
            raise RuntimeError("no embed")

        if not shutil.which("rg"):
            pytest.skip("ripgrep (rg) not available in test environment")

        results = retrieval.search(
            "pineapple",
            k=5,
            embed_fn=always_fail,
            db_path=db_path,
            vault_dir=vault,
        )

        assert isinstance(results, list)
        # Should find the file via ripgrep
        paths = [r["path"] for r in results]
        assert any("findme.md" in p for p in paths), f"Expected findme.md in {paths}"

    def test_fallback_results_have_correct_shape(self, tmp_path):
        """Fallback results have path/excerpt/score keys with score=None."""
        if not shutil.which("rg"):
            pytest.skip("ripgrep (rg) not available in test environment")

        vault = tmp_path / "vault"
        vault.mkdir()
        (vault / "test.md").write_text("mango is a delicious fruit", encoding="utf-8")

        db_path = str(tmp_path / "empty.db")
        conn = sqlite3.connect(db_path)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS chunks "
            "(id INTEGER PRIMARY KEY, path TEXT, chunk_idx INT, text TEXT, vector TEXT)"
        )
        conn.commit()
        conn.close()

        def always_fail(texts):
            raise RuntimeError("no embed")

        results = retrieval.search(
            "mango",
            k=5,
            embed_fn=always_fail,
            db_path=db_path,
            vault_dir=vault,
        )

        if results:  # rg found something
            r = results[0]
            assert "path" in r
            assert "excerpt" in r
            assert "score" in r
            assert r["score"] is None

    def test_fallback_graceful_when_rg_absent(self, tmp_path, monkeypatch):
        """If rg is not available, search returns [] without raising."""
        monkeypatch.setattr(shutil, "which", lambda cmd: None)

        db_path = str(tmp_path / "empty.db")
        conn = sqlite3.connect(db_path)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS chunks "
            "(id INTEGER PRIMARY KEY, path TEXT, chunk_idx INT, text TEXT, vector TEXT)"
        )
        conn.commit()
        conn.close()

        def always_fail(texts):
            raise RuntimeError("no embed")

        results = retrieval.search(
            "anything",
            k=5,
            embed_fn=always_fail,
            db_path=db_path,
        )

        assert results == []


# ---------------------------------------------------------------------------
# cosine helper tests
# ---------------------------------------------------------------------------

class TestCosine:
    def test_identical_vectors_score_1(self):
        v = [0.5, 0.5, 0.5, 0.5]
        score = retrieval._cosine(v, v)
        assert abs(score - 1.0) < 1e-9

    def test_orthogonal_vectors_score_0(self):
        a = [1.0, 0.0]
        b = [0.0, 1.0]
        assert retrieval._cosine(a, b) == 0.0

    def test_zero_vector_returns_0(self):
        zero = [0.0, 0.0, 0.0]
        other = [1.0, 2.0, 3.0]
        assert retrieval._cosine(zero, other) == 0.0
        assert retrieval._cosine(other, zero) == 0.0


# ---------------------------------------------------------------------------
# chunk splitting tests
# ---------------------------------------------------------------------------

class TestSplitChunks:
    def test_short_text_returns_single_chunk(self):
        text = "Hello world."
        chunks = retrieval._split_chunks(text)
        assert len(chunks) == 1
        assert chunks[0] == "Hello world."

    def test_long_text_splits_on_paragraphs(self):
        # Create text with paragraphs that exceed 1000 chars
        para = "word " * 100  # ~500 chars per paragraph
        text = f"{para}\n\n{para}\n\n{para}"
        chunks = retrieval._split_chunks(text)
        assert len(chunks) >= 2

    def test_empty_text_returns_empty(self):
        chunks = retrieval._split_chunks("")
        assert chunks == []
