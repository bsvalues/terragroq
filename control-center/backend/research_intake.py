"""Research Drop Zone intake pipeline.

This is a controlled intake path, not an autonomous research agent. It preserves
the original file, creates a normalized markdown note, records metadata, and
updates local search/RAG indexes where available.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import html
import json
import mimetypes
import os
import re
import shutil
from dataclasses import asdict, dataclass
from io import BytesIO
from pathlib import Path
from typing import Callable

from copilot import retrieval


PROJECT_ROOT = Path(__file__).resolve().parents[2]
VAULT = Path(os.environ.get("WILLIAMOS_VAULT", str(PROJECT_ROOT / "WilliamOS")))
INTAKE_ROOT = VAULT / "110_ControlCenter" / "research_intake"
ORIGINALS_DIR = INTAKE_ROOT / "originals"
METADATA_DIR = INTAKE_ROOT / "metadata"
NOTES_DIR = VAULT / "07_Learning" / "Research Intake"

SUPPORTED_EXTENSIONS = {
    ".pdf",
    ".txt",
    ".md",
    ".markdown",
    ".csv",
    ".html",
    ".htm",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
}

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
TEXT_EXTENSIONS = {".txt", ".md", ".markdown", ".csv"}
HTML_EXTENSIONS = {".html", ".htm"}

CLASSIFICATIONS = [
    "Research",
    "Evidence",
    "Work item",
    "Decision support",
    "TerraFusion",
    "Appraisal / county",
    "Personal notes",
    "Inbox",
]


@dataclass
class IntakeItem:
    source_filename: str
    hash: str
    size: int
    type: str
    content_type: str
    ingested_at: str
    classification: str
    destination: str
    original_path: str
    note_path: str
    duplicate: bool
    extracted_chars: int
    search_index: dict
    rag_index: dict


def ingest_file(
    filename: str,
    content: bytes,
    content_type: str | None = None,
    classification: str | None = None,
    *,
    semantic_indexer: Callable[[], dict] | None = None,
    rag_indexer: Callable[[Path], dict] | None = None,
    run_indexes: bool = True,
) -> dict:
    """Preserve a supported file and create a normalized markdown note."""
    clean_name = _safe_filename(filename)
    ext = Path(clean_name).suffix.lower()
    size = len(content)
    detected_type = _detect_type(ext)

    if ext not in SUPPORTED_EXTENSIONS:
        return {
            "ok": False,
            "error": "Unsupported file type",
            "message": f"{ext or 'unknown'} is not supported for research intake.",
            "supported": sorted(SUPPORTED_EXTENSIONS),
        }

    file_hash = hashlib.sha256(content).hexdigest()
    metadata_path = METADATA_DIR / f"{file_hash}.json"

    if metadata_path.exists():
        existing = _read_metadata(metadata_path)
        existing["duplicate"] = True
        return {
            "ok": True,
            "duplicate": True,
            "message": "This file is already in research intake. No new copy was created.",
            "item": existing,
        }

    extracted = _extract_text(clean_name, content, ext)
    selected_classification = _normalize_classification(classification) or _classify(clean_name, extracted)

    ORIGINALS_DIR.mkdir(parents=True, exist_ok=True)
    METADATA_DIR.mkdir(parents=True, exist_ok=True)
    NOTES_DIR.mkdir(parents=True, exist_ok=True)

    original_path = ORIGINALS_DIR / f"{file_hash[:12]}-{clean_name}"
    note_path = NOTES_DIR / f"{dt.date.today().isoformat()}-{_slug(Path(clean_name).stem)}-{file_hash[:8]}.md"

    original_path.write_bytes(content)
    note_path.write_text(
        _render_note(
            filename=clean_name,
            original_path=original_path,
            file_hash=file_hash,
            size=size,
            file_type=detected_type,
            content_type=content_type or mimetypes.guess_type(clean_name)[0] or "application/octet-stream",
            classification=selected_classification,
            extracted_text=extracted,
        ),
        encoding="utf-8",
    )

    semantic_result: dict = {"ok": False, "skipped": not run_indexes}
    rag_result: dict = {"ok": False, "skipped": not run_indexes}
    if run_indexes:
        semantic_result = _run_semantic_index(semantic_indexer)
        rag_result = _run_rag_index(note_path, rag_indexer)

    item = IntakeItem(
        source_filename=clean_name,
        hash=file_hash,
        size=size,
        type=detected_type,
        content_type=content_type or mimetypes.guess_type(clean_name)[0] or "application/octet-stream",
        ingested_at=dt.datetime.now().isoformat(timespec="seconds"),
        classification=selected_classification,
        destination=str(NOTES_DIR),
        original_path=str(original_path),
        note_path=str(note_path),
        duplicate=False,
        extracted_chars=len(extracted),
        search_index=semantic_result,
        rag_index=rag_result,
    )

    metadata_path.write_text(json.dumps(asdict(item), indent=2), encoding="utf-8")

    return {
        "ok": True,
        "duplicate": False,
        "message": "Research intake complete.",
        "item": asdict(item),
    }


def history(limit: int = 20) -> dict:
    """Return recent intake metadata for History and Evidence surfaces."""
    if not METADATA_DIR.exists():
        return {"ok": True, "items": []}

    items = []
    for path in sorted(METADATA_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        item = _read_metadata(path)
        if item:
            items.append(item)
        if len(items) >= limit:
            break
    return {"ok": True, "items": items}


def _read_metadata(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _safe_filename(filename: str) -> str:
    name = Path(filename or "research-file").name.strip()
    name = re.sub(r"[^A-Za-z0-9._ -]+", "-", name)
    name = re.sub(r"\s+", " ", name).strip(" .")
    return name[:150] or "research-file"


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:70] or "research"


def _detect_type(ext: str) -> str:
    if ext == ".pdf":
        return "pdf"
    if ext in IMAGE_EXTENSIONS:
        return "image"
    if ext in HTML_EXTENSIONS:
        return "html"
    if ext == ".csv":
        return "csv"
    if ext in {".md", ".markdown"}:
        return "markdown"
    return "text"


def _extract_text(filename: str, content: bytes, ext: str) -> str:
    if ext == ".pdf":
        return _extract_pdf(content)
    if ext in TEXT_EXTENSIONS:
        return _decode_text(content)
    if ext in HTML_EXTENSIONS:
        return _strip_html(_decode_text(content))
    if ext in IMAGE_EXTENSIONS:
        return _image_metadata(filename, content)
    return ""


def _decode_text(content: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16", "cp1252"):
        try:
            return content.decode(encoding).strip()
        except UnicodeError:
            continue
    return content.decode("utf-8", errors="ignore").strip()


def _extract_pdf(content: bytes) -> str:
    try:
        from pypdf import PdfReader

        reader = PdfReader(BytesIO(content))
        pages = []
        for i, page in enumerate(reader.pages, 1):
            text = page.extract_text() or ""
            if text.strip():
                pages.append(f"## Page {i}\n\n{text.strip()}")
        return "\n\n".join(pages).strip()
    except Exception as exc:
        return f"PDF text extraction failed locally: {exc}"


def _strip_html(text: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _image_metadata(filename: str, content: bytes) -> str:
    try:
        from PIL import Image

        with Image.open(BytesIO(content)) as img:
            width, height = img.size
            return (
                f"Image preserved as original intake file.\n\n"
                f"- Filename: {filename}\n"
                f"- Format: {img.format or 'unknown'}\n"
                f"- Dimensions: {width}x{height}\n\n"
                "No OCR text was extracted."
            )
    except Exception:
        return "Image preserved as original intake file. No OCR text was extracted."


def _normalize_classification(value: str | None) -> str | None:
    if not value:
        return None
    value_l = value.strip().lower()
    for option in CLASSIFICATIONS:
        if option.lower() == value_l:
            return option
    return None


def _classify(filename: str, extracted: str) -> str:
    text = f"{filename}\n{extracted[:2000]}".lower()
    if any(term in text for term in ("terrafusion", "terra fusion")):
        return "TerraFusion"
    if any(term in text for term in ("appraisal", "cama", "county", "assessor", "parcel")):
        return "Appraisal / county"
    if any(term in text for term in ("decision", "approved", "rejected", "tradeoff")):
        return "Decision support"
    if any(term in text for term in ("todo", "work order", "next step", "acceptance")):
        return "Work item"
    if any(term in text for term in ("evidence", "citation", "source")):
        return "Evidence"
    return "Research"


def _render_note(
    *,
    filename: str,
    original_path: Path,
    file_hash: str,
    size: int,
    file_type: str,
    content_type: str,
    classification: str,
    extracted_text: str,
) -> str:
    extracted = extracted_text.strip() or "No extractable text was found."
    summary = _summary(extracted)
    today = dt.date.today().isoformat()
    return f"""---
type: research-intake
created: {today}
classification: {json.dumps(classification)}
authority: unreviewed
canon: false
source_filename: {json.dumps(filename)}
source_hash: {file_hash}
source_type: {file_type}
---

# Research Intake - {filename}

## Intake Boundary

This note was created by the Phase 5C Research Drop Zone. It is intake only. Promotion to canon requires a separate reviewed action.

## Source

- Original: `{original_path}`
- Hash: `{file_hash}`
- Size: {size} bytes
- Type: {file_type}
- Content type: {content_type}
- Classification: {classification}

## Short Summary

{summary}

## Extracted Text

{extracted}
"""


def _summary(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip()
    if not cleaned:
        return "No summary available because no extractable text was found."
    if len(cleaned) <= 700:
        return cleaned
    return f"{cleaned[:700].rstrip()}..."


def _run_semantic_index(indexer: Callable[[], dict] | None) -> dict:
    try:
        if indexer:
            return indexer()
        import sys

        scripts_dir = PROJECT_ROOT / "scripts"
        if str(scripts_dir) not in sys.path:
            sys.path.insert(0, str(scripts_dir))
        import williamos_search

        result = williamos_search.build_index()
        return {"ok": "error" not in result, **result}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def _run_rag_index(note_path: Path, indexer: Callable[[Path], dict] | None) -> dict:
    try:
        result = indexer(note_path) if indexer else retrieval.index_markdown_file(note_path)
        if "ok" not in result:
            result = {"ok": True, **result}
        return result
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def clear_intake_for_test(root: Path) -> None:
    """Test helper. Not used by the application."""
    if root.exists():
        shutil.rmtree(root)
