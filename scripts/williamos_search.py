"""WilliamOS local semantic search engine.

Supports three modes:
  - semantic: sentence-transformers local embeddings (best quality)
  - tfidf: scikit-learn TF-IDF vectors (good fallback)
  - unavailable: prints setup instructions

Never modifies source notes. Index is stored under WilliamOS/40_Search/generated/.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))
SEARCH_DIR = VAULT / "40_Search"
GENERATED_DIR = SEARCH_DIR / "generated"
STATUS_FILE = GENERATED_DIR / "status.json"
CHUNKS_FILE = GENERATED_DIR / "chunks.json"

INDEX_INCLUDE_DIRS = [
    "02_Decisions", "03_Doctrine", "04_Appraisal", "05_Assessor_Office",
    "06_TerraFusion_Strategy", "07_Learning", "09_Cases", "10_Ideas",
    "11_Projects", "50_Dashboards",
]

INDEX_EXCLUDE_DIRS = {
    "00_Inbox", "01_Daily", "08_People", "12_Maps", "13_Templates",
    "20_Graphify", "30_MCP", "40_Scripts", "40_Search", "90_Exports", "99_Archive",
}

CHUNK_MAX_CHARS = 1200
CHUNK_OVERLAP_CHARS = 200


def _detect_mode() -> str:
    try:
        import sentence_transformers  # noqa: F401
        return "semantic"
    except ImportError:
        pass
    try:
        from sklearn.feature_extraction.text import TfidfVectorizer  # noqa: F401
        return "tfidf"
    except ImportError:
        pass
    return "unavailable"


def _collect_files() -> list[Path]:
    files = []
    for folder in INDEX_INCLUDE_DIRS:
        d = VAULT / folder
        if d.exists():
            files.extend(sorted(d.rglob("*.md")))
    return files


def _strip_frontmatter(text: str) -> str:
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            return parts[2].strip()
    return text.strip()


def _extract_title(text: str) -> str:
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("# "):
            return line[2:].strip()
    return ""


def _chunk_text(text: str, source_path: str, title: str) -> list[dict[str, Any]]:
    body = _strip_frontmatter(text)
    if not body.strip():
        return []

    sections: list[str] = []
    current: list[str] = []
    for line in body.splitlines():
        if re.match(r"^#{1,3}\s", line) and current:
            sections.append("\n".join(current))
            current = [line]
        else:
            current.append(line)
    if current:
        sections.append("\n".join(current))

    chunks = []
    for section in sections:
        section = section.strip()
        if len(section) < 20:
            continue
        if len(section) <= CHUNK_MAX_CHARS:
            chunks.append(section)
        else:
            start = 0
            while start < len(section):
                end = start + CHUNK_MAX_CHARS
                chunks.append(section[start:end])
                start = end - CHUNK_OVERLAP_CHARS

    return [
        {"source": source_path, "title": title, "chunk_index": i, "text": c}
        for i, c in enumerate(chunks)
    ]


def build_index() -> dict[str, Any]:
    mode = _detect_mode()
    if mode == "unavailable":
        return {"mode": "unavailable", "error": "no_dependencies"}

    files = _collect_files()
    all_chunks: list[dict[str, Any]] = []

    for f in files:
        text = f.read_text(encoding="utf-8", errors="ignore")
        title = _extract_title(text) or f.stem
        rel = str(f.relative_to(VAULT)).replace("\\", "/")
        chunks = _chunk_text(text, rel, title)
        all_chunks.extend(chunks)

    if not all_chunks:
        return {"mode": mode, "error": "no_content", "files": len(files)}

    GENERATED_DIR.mkdir(parents=True, exist_ok=True)

    texts = [c["text"] for c in all_chunks]

    if mode == "semantic":
        import numpy as np
        from sentence_transformers import SentenceTransformer
        model_name = "all-MiniLM-L6-v2"
        model = SentenceTransformer(model_name)
        vectors = model.encode(texts, show_progress_bar=True, normalize_embeddings=True)
        np.save(str(GENERATED_DIR / "vectors.npy"), vectors)
        model_info = model_name
    else:
        import joblib
        from sklearn.feature_extraction.text import TfidfVectorizer
        vectorizer = TfidfVectorizer(max_features=5000, stop_words="english")
        matrix = vectorizer.fit_transform(texts)
        joblib.dump({"vectorizer": vectorizer, "matrix": matrix}, str(GENERATED_DIR / "tfidf.joblib"))
        model_info = "TfidfVectorizer"

    for c in all_chunks:
        c.pop("text", None)
    chunk_meta = [
        {"source": c["source"], "title": c["title"], "chunk_index": c["chunk_index"]}
        for c in all_chunks
    ]

    with open(CHUNKS_FILE, "w", encoding="utf-8") as fh:
        json.dump({"chunks": chunk_meta, "texts": texts}, fh, indent=2)

    import datetime as dt
    status = {
        "created_at": dt.datetime.now().isoformat(timespec="seconds"),
        "mode": mode,
        "model": model_info,
        "files_indexed": len(files),
        "chunks_indexed": len(all_chunks),
        "vault_root": str(VAULT),
        "source_policy": "default",
    }
    with open(STATUS_FILE, "w", encoding="utf-8") as fh:
        json.dump(status, fh, indent=2)

    return status


def search(query: str, top_k: int = 8) -> list[dict[str, Any]]:
    if not STATUS_FILE.exists() or not CHUNKS_FILE.exists():
        return [{"error": "no_index"}]

    with open(STATUS_FILE, encoding="utf-8") as fh:
        status = json.load(fh)
    with open(CHUNKS_FILE, encoding="utf-8") as fh:
        data = json.load(fh)

    chunks_meta = data["chunks"]
    texts = data["texts"]
    mode = status["mode"]

    if mode == "semantic":
        import numpy as np
        from sentence_transformers import SentenceTransformer
        vectors = np.load(str(GENERATED_DIR / "vectors.npy"))
        model = SentenceTransformer(status["model"])
        q_vec = model.encode([query], normalize_embeddings=True)
        scores = (vectors @ q_vec.T).flatten()
        top_idx = scores.argsort()[::-1][:top_k]
        results = []
        for rank, idx in enumerate(top_idx, 1):
            score = float(scores[idx])
            if score < 0.05:
                continue
            meta = chunks_meta[idx]
            excerpt = texts[idx][:300].strip()
            results.append({
                "rank": rank,
                "score": round(score, 4),
                "source": meta["source"],
                "title": meta["title"],
                "excerpt": excerpt,
            })
        return results

    elif mode == "tfidf":
        import joblib  # safe: loading locally-generated index only
        bundle = joblib.load(str(GENERATED_DIR / "tfidf.joblib"))
        vectorizer = bundle["vectorizer"]
        matrix = bundle["matrix"]
        q_vec = vectorizer.transform([query])
        scores = (matrix @ q_vec.T).toarray().flatten()
        top_idx = scores.argsort()[::-1][:top_k]
        results = []
        for rank, idx in enumerate(top_idx, 1):
            score = float(scores[idx])
            if score < 0.01:
                continue
            meta = chunks_meta[idx]
            excerpt = texts[idx][:300].strip()
            results.append({
                "rank": rank,
                "score": round(score, 4),
                "source": meta["source"],
                "title": meta["title"],
                "excerpt": excerpt,
            })
        return results

    return [{"error": "unknown_mode", "mode": mode}]


def get_status() -> dict[str, Any]:
    mode = _detect_mode()
    if not STATUS_FILE.exists():
        return {"index_exists": False, "available_mode": mode}
    with open(STATUS_FILE, encoding="utf-8") as fh:
        status = json.load(fh)
    status["index_exists"] = True
    status["available_mode"] = mode
    return status


def clear_index(confirm: bool = False) -> bool:
    if not GENERATED_DIR.exists():
        return False
    if not confirm:
        return False
    import shutil
    shutil.rmtree(GENERATED_DIR)
    return True
