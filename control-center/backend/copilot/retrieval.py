"""Vault RAG retrieval — index and search the user's markdown vault.

Environment:
  WILLIAMOS_COPILOT_INDEX_DB   Path to the SQLite index db
                               (default: control-center/backend/copilot_index.db)
  WILLIAMOS_VAULT_DIR          Vault root dir (default: <project root>/WilliamOS)
"""

from __future__ import annotations

import json
import math
import os
import shutil
import sqlite3
import subprocess
from pathlib import Path
from typing import Callable

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_HERE = Path(__file__).resolve().parent  # control-center/backend/copilot/
_BACKEND = _HERE.parent                  # control-center/backend/
_PROJECT_ROOT = _BACKEND.parent.parent   # project root


def _default_db() -> str:
    return os.environ.get(
        "WILLIAMOS_COPILOT_INDEX_DB",
        str(_BACKEND / "copilot_index.db"),
    )


def _default_vault() -> Path:
    vault_env = os.environ.get("WILLIAMOS_VAULT_DIR")
    if vault_env:
        return Path(vault_env)
    return _PROJECT_ROOT / "WilliamOS"


# ---------------------------------------------------------------------------
# SQLite helpers
# ---------------------------------------------------------------------------

def _connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS chunks (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            path      TEXT    NOT NULL,
            chunk_idx INTEGER NOT NULL,
            text      TEXT    NOT NULL,
            vector    TEXT    NOT NULL
        )
        """
    )
    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# Text chunking
# ---------------------------------------------------------------------------

_CHUNK_SIZE = 1000


def _split_chunks(text: str) -> list[str]:
    """Split text into ~1000-char chunks on paragraph boundaries."""
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0

    for para in paragraphs:
        if current and current_len + len(para) > _CHUNK_SIZE:
            chunks.append("\n\n".join(current))
            current = [para]
            current_len = len(para)
        else:
            current.append(para)
            current_len += len(para)

    if current:
        chunks.append("\n\n".join(current))

    # If no paragraph splits worked (e.g. very long single paragraph), hard-split
    if not chunks:
        for i in range(0, max(len(text), 1), _CHUNK_SIZE):
            chunk = text[i : i + _CHUNK_SIZE].strip()
            if chunk:
                chunks.append(chunk)

    return chunks


# ---------------------------------------------------------------------------
# Pure-Python cosine similarity
# ---------------------------------------------------------------------------

def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


# ---------------------------------------------------------------------------
# Default embed_fn
# ---------------------------------------------------------------------------

def _default_embed(texts: list[str]) -> list[list[float]]:
    from copilot import llm  # lazy import — avoids httpx import cost at module load

    return llm.embed(texts)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def build_index(
    vault_dir: str | Path | None = None,
    embed_fn: Callable[[list[str]], list[list[float]]] | None = None,
    db_path: str | None = None,
) -> dict:
    """Walk vault_dir/**/*.md, chunk, embed, upsert into the index db.

    Returns {"files": int, "chunks": int, "skipped": int, "db": str}.
    Re-indexing a file is idempotent (old chunks for that path are removed first).
    """
    vault = Path(vault_dir) if vault_dir else _default_vault()
    db = db_path or _default_db()
    embed = embed_fn or _default_embed

    conn = _connect(db)
    files_indexed = 0
    chunks_indexed = 0
    chunks_skipped = 0

    md_files = list(vault.rglob("*.md"))

    for md_path in md_files:
        try:
            text = md_path.read_text(encoding="utf-8", errors="ignore").strip()
        except Exception:
            continue

        if not text:
            continue

        chunks = _split_chunks(text)
        if not chunks:
            continue

        # Embed all chunks for this file at once
        try:
            vectors = embed(chunks)
        except Exception:
            # If embed fails for the whole file, skip all its chunks
            chunks_skipped += len(chunks)
            continue

        # Remove old rows for this path (idempotent re-index)
        conn.execute("DELETE FROM chunks WHERE path = ?", (str(md_path),))

        # Insert new rows
        for idx, (chunk_text, vector) in enumerate(zip(chunks, vectors)):
            try:
                conn.execute(
                    "INSERT INTO chunks (path, chunk_idx, text, vector) VALUES (?, ?, ?, ?)",
                    (str(md_path), idx, chunk_text, json.dumps(vector)),
                )
                chunks_indexed += 1
            except Exception:
                chunks_skipped += 1

        conn.commit()
        files_indexed += 1

    conn.close()
    return {
        "files": files_indexed,
        "chunks": chunks_indexed,
        "skipped": chunks_skipped,
        "db": db,
    }


def index_markdown_file(
    md_path: str | Path,
    embed_fn: Callable[[list[str]], list[list[float]]] | None = None,
    db_path: str | None = None,
) -> dict:
    """Index one markdown file into the RAG db.

    Re-indexing the same path is idempotent. This is used by research intake so
    a dropped file can become citable without rebuilding the entire vault index.
    """
    path = Path(md_path)
    db = db_path or _default_db()
    embed = embed_fn or _default_embed

    if path.suffix.lower() != ".md":
        return {"ok": False, "error": "not_markdown", "path": str(path)}

    try:
        text = path.read_text(encoding="utf-8", errors="ignore").strip()
    except Exception as exc:
        return {"ok": False, "error": f"read_failed: {exc}", "path": str(path)}

    conn = _connect(db)
    conn.execute("DELETE FROM chunks WHERE path = ?", (str(path),))

    if not text:
        conn.commit()
        conn.close()
        return {"ok": True, "path": str(path), "chunks": 0, "skipped": 0, "db": db}

    chunks = _split_chunks(text)
    try:
        vectors = embed(chunks)
    except Exception as exc:
        conn.commit()
        conn.close()
        return {
            "ok": False,
            "error": f"embed_failed: {exc}",
            "path": str(path),
            "chunks": 0,
            "skipped": len(chunks),
            "db": db,
        }

    indexed = 0
    skipped = 0
    for idx, (chunk_text, vector) in enumerate(zip(chunks, vectors)):
        try:
            conn.execute(
                "INSERT INTO chunks (path, chunk_idx, text, vector) VALUES (?, ?, ?, ?)",
                (str(path), idx, chunk_text, json.dumps(vector)),
            )
            indexed += 1
        except Exception:
            skipped += 1

    conn.commit()
    conn.close()
    return {"ok": True, "path": str(path), "chunks": indexed, "skipped": skipped, "db": db}


def search(
    query: str,
    k: int = 5,
    embed_fn: Callable[[list[str]], list[list[float]]] | None = None,
    db_path: str | None = None,
    vault_dir: str | Path | None = None,
) -> list[dict]:
    """Semantic search over the vault index; falls back to ripgrep keyword search.

    Returns list of {"path": str, "excerpt": str, "score": float | None}.
    Never raises.
    """
    db = db_path or _default_db()
    embed = embed_fn or _default_embed

    try:
        return _vector_search(query, k, embed, db)
    except _FallbackNeeded:
        pass
    except Exception:
        pass

    # Fallback: ripgrep keyword search
    return _ripgrep_search(query, k, vault_dir)


# ---------------------------------------------------------------------------
# Internal search helpers
# ---------------------------------------------------------------------------

class _FallbackNeeded(Exception):
    pass


def _vector_search(
    query: str,
    k: int,
    embed_fn: Callable[[list[str]], list[list[float]]],
    db_path: str,
) -> list[dict]:
    """Raise _FallbackNeeded if the index is empty or embedding fails."""
    # Check if index has rows
    try:
        conn = _connect(db_path)
        row = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()
        count = row[0] if row else 0
    except Exception:
        raise _FallbackNeeded()

    if count == 0:
        conn.close()
        raise _FallbackNeeded()

    # Embed the query
    try:
        q_vecs = embed_fn([query])
        q_vec = q_vecs[0]
    except Exception:
        conn.close()
        raise _FallbackNeeded()

    # Load all rows and rank by cosine similarity
    rows = conn.execute("SELECT path, chunk_idx, text, vector FROM chunks").fetchall()
    conn.close()

    scored: list[tuple[float, str, str]] = []
    for path, _idx, text, vector_json in rows:
        try:
            vec = json.loads(vector_json)
            score = _cosine(q_vec, vec)
        except Exception:
            continue
        scored.append((score, path, text))

    scored.sort(key=lambda t: t[0], reverse=True)
    top = scored[:k]

    return [
        {
            "path": path,
            "excerpt": text[:300],
            "score": round(score, 6),
        }
        for score, path, text in top
    ]


def _ripgrep_search(
    query: str,
    k: int,
    vault_dir: str | Path | None = None,
) -> list[dict]:
    """Keyword fallback using ripgrep. Returns [] if rg unavailable or fails."""
    if not shutil.which("rg"):
        return []

    vault = Path(vault_dir) if vault_dir else _default_vault()
    if not vault.exists():
        return []

    # Build search terms from query words
    terms = query.split()
    if not terms:
        return []

    # Use the first term for file-level search; can be refined
    pattern = "|".join(terms[:3])  # search for any of first 3 words

    try:
        # Get matching file paths
        files_proc = subprocess.run(
            ["rg", "-i", "-l", pattern, str(vault)],
            capture_output=True,
            text=True,
            timeout=10,
        )
        matching_files = [
            f.strip() for f in files_proc.stdout.splitlines() if f.strip()
        ][:k]
    except Exception:
        return []

    results: list[dict] = []
    for fpath in matching_files:
        try:
            # Get a matching excerpt line
            line_proc = subprocess.run(
                ["rg", "-i", "-m", "1", pattern, fpath],
                capture_output=True,
                text=True,
                timeout=5,
            )
            excerpt = line_proc.stdout.strip()[:300] if line_proc.stdout else ""
        except Exception:
            excerpt = ""

        results.append({"path": fpath, "excerpt": excerpt, "score": None})

    return results
