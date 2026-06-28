"""WilliamOS cortex map generator.

Builds a personal graph from vault notes, links, tags, and frontmatter.
Identifies central nodes, orphans, bridge concepts, repeated themes,
and missing-link opportunities. Generates cortex review reports,
graph JSON, Mermaid maps, and suggested link reports.

Local-first, deterministic. Optionally reads Graphify output and
semantic search metadata. Never modifies source notes.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import frontmatter as fm

VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))
CORTEX_DIR = VAULT / "88_CortexMap"
REPORTS_DIR = CORTEX_DIR / "reports"
GRAPHS_DIR = CORTEX_DIR / "graphs"
MAPS_DIR = CORTEX_DIR / "maps"
SUGGESTED_LINKS_DIR = CORTEX_DIR / "suggested_links"

CORE_SOURCE_DIRS = [
    "01_Daily",
    "02_Decisions",
    "03_Doctrine",
    "04_Appraisal",
    "05_Assessor_Office",
    "06_TerraFusion_Strategy",
    "07_Learning",
    "09_Cases",
    "10_Ideas",
    "11_Projects",
]

PROMOTION_SOURCE_DIRS = [
    "60_Synthesis",
    "70_InboxProcessor/reports",
    "70_InboxProcessor/promoted_drafts",
    "80_DoctrinePromotion/reports",
    "80_DoctrinePromotion/drafts",
    "85_DecisionPromotion/reports",
    "85_DecisionPromotion/drafts",
    "86_ConceptPromotion/reports",
    "86_ConceptPromotion/drafts",
    "87_ProjectPromotion/reports",
    "87_ProjectPromotion/project_drafts",
    "87_ProjectPromotion/work_order_drafts",
]

OPTIONAL_SOURCES = [
    "20_Graphify/graph.json",
    "40_Search/generated/status.json",
]

EXCLUDED_PATHS = {
    "13_Templates",
    "20_Graphify/generated/cache",
    "30_MCP/examples",
    "40_Search/generated/chunks.json",
    "40_Search/generated/vectors.npy",
    "40_Search/generated/tfidf.joblib",
    "60_Synthesis/generated/cache",
    "70_InboxProcessor/generated/cache",
    "80_DoctrinePromotion/generated/cache",
    "85_DecisionPromotion/generated/cache",
    "86_ConceptPromotion/generated/cache",
    "87_ProjectPromotion/generated/cache",
    "88_CortexMap/generated/cache",
    "90_Exports",
    "99_Archive",
}

WIKI_LINK_RE = re.compile(r"\[\[([^\]|#]+)(?:[|#][^\]]*)?]]")
MD_LINK_RE = re.compile(r"\[([^\]]+)]\(([^)]+)\)")
TAG_RE = re.compile(r"(?:^|\s)#([A-Za-z][A-Za-z0-9_/-]+)", re.MULTILINE)

FOLDER_TYPE_MAP = {
    "01_Daily": "daily",
    "02_Decisions": "decision",
    "03_Doctrine": "doctrine",
    "04_Appraisal": "note",
    "05_Assessor_Office": "note",
    "06_TerraFusion_Strategy": "note",
    "07_Learning": "note",
    "09_Cases": "case",
    "10_Ideas": "concept",
    "11_Projects": "project",
    "60_Synthesis": "synthesis",
    "70_InboxProcessor": "promotion_report",
    "80_DoctrinePromotion": "promotion_report",
    "85_DecisionPromotion": "promotion_report",
    "86_ConceptPromotion": "promotion_report",
    "87_ProjectPromotion": "promotion_report",
}


def _local_today() -> dt.date:
    tz_name = os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles")
    return dt.datetime.now(ZoneInfo(tz_name)).date()


def _is_excluded(rel_path: str) -> bool:
    for exc in EXCLUDED_PATHS:
        if rel_path.startswith(exc):
            return True
    return False


def scan_cortex_sources(scope: str = "all") -> list[dict[str, Any]]:
    if scope == "core":
        dirs = CORE_SOURCE_DIRS
    elif scope == "promotions":
        dirs = PROMOTION_SOURCE_DIRS
    else:
        dirs = CORE_SOURCE_DIRS + PROMOTION_SOURCE_DIRS

    notes: list[dict[str, Any]] = []
    for d in dirs:
        source_path = VAULT / d
        if not source_path.exists():
            continue
        if source_path.is_file() and source_path.suffix == ".md":
            rel = str(source_path.relative_to(VAULT)).replace("\\", "/")
            if not _is_excluded(rel):
                notes.append({"path": source_path, "rel": rel})
            continue
        for p in sorted(source_path.rglob("*.md")):
            rel = str(p.relative_to(VAULT)).replace("\\", "/")
            if _is_excluded(rel):
                continue
            notes.append({"path": p, "rel": rel})
    return notes


def parse_frontmatter(path: Path) -> dict[str, Any]:
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
        post = fm.loads(text)
        return {
            "metadata": dict(post.metadata) if post.metadata else {},
            "content": post.content,
            "raw": text,
        }
    except Exception:
        text = path.read_text(encoding="utf-8", errors="ignore")
        return {"metadata": {}, "content": text, "raw": text}


def extract_wiki_links(content: str) -> list[str]:
    return [m.group(1).strip() for m in WIKI_LINK_RE.finditer(content)]


def extract_markdown_links(content: str) -> list[tuple[str, str]]:
    return [(m.group(1), m.group(2)) for m in MD_LINK_RE.finditer(content)]


def extract_tags(metadata: dict[str, Any], content: str) -> list[str]:
    tags = set()
    fm_tags = metadata.get("tags", [])
    if isinstance(fm_tags, list):
        tags.update(str(t).strip() for t in fm_tags if t)
    inline = TAG_RE.findall(content)
    tags.update(inline)
    return sorted(tags)


def infer_node_type(rel_path: str, metadata: dict[str, Any]) -> str:
    fm_type = metadata.get("type", "")
    if fm_type:
        type_str = str(fm_type).lower()
        type_map = {
            "doctrine": "doctrine",
            "decision": "decision",
            "concept": "concept",
            "project": "project",
            "work-order": "work_order",
            "work_order": "work_order",
            "case": "case",
            "daily": "daily",
            "weekly-synthesis": "synthesis",
            "synthesis": "synthesis",
            "inbox-triage": "promotion_report",
            "doctrine-promotion": "promotion_report",
            "decision-promotion": "promotion_report",
            "concept-promotion": "promotion_report",
            "project-promotion": "promotion_report",
            "cortex-review": "promotion_report",
            "promoted-draft": "promotion_draft",
            "doctrine-draft": "promotion_draft",
            "decision-draft": "promotion_draft",
            "concept-draft": "promotion_draft",
            "project-draft": "promotion_draft",
            "wo-draft": "promotion_draft",
        }
        if type_str in type_map:
            return type_map[type_str]

    parts = rel_path.replace("\\", "/").split("/")
    if parts:
        top = parts[0]
        for prefix, ntype in FOLDER_TYPE_MAP.items():
            if top.startswith(prefix):
                return ntype
        if "drafts" in rel_path.lower():
            return "promotion_draft"
        if "reports" in rel_path.lower():
            return "promotion_report"
    return "note"


def build_graph(notes: list[dict[str, Any]]) -> dict[str, Any]:
    nodes: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, Any]] = []

    stem_to_id: dict[str, str] = {}
    all_tags: set[str] = set()
    all_folders: set[str] = set()

    for note in notes:
        path = note["path"]
        rel = note["rel"]
        parsed = parse_frontmatter(path)
        metadata = parsed["metadata"]
        content = parsed["content"]
        raw = parsed["raw"]

        node_id = rel
        stem = path.stem
        stem_to_id[stem] = node_id

        tags = extract_tags(metadata, content)
        all_tags.update(tags)

        parts = rel.replace("\\", "/").split("/")
        folder = parts[0] if parts else ""
        all_folders.add(folder)

        node_type = infer_node_type(rel, metadata)
        status = str(metadata.get("status", "")).strip() or ""

        nodes[node_id] = {
            "id": node_id,
            "label": stem,
            "type": node_type,
            "path": rel,
            "folder": folder,
            "tags": tags,
            "status": status,
            "metrics": {
                "in_degree": 0,
                "out_degree": 0,
                "total_degree": 0,
                "bridge_score": 0,
                "orphan": False,
            },
            "_wiki_links": extract_wiki_links(raw),
            "_md_links": extract_markdown_links(raw),
            "_content": content,
        }

    for tag in all_tags:
        tag_id = f"tag:{tag}"
        if tag_id not in nodes:
            nodes[tag_id] = {
                "id": tag_id,
                "label": f"#{tag}",
                "type": "tag",
                "path": "",
                "folder": "",
                "tags": [],
                "status": "",
                "metrics": {
                    "in_degree": 0,
                    "out_degree": 0,
                    "total_degree": 0,
                    "bridge_score": 0,
                    "orphan": False,
                },
            }

    for folder in all_folders:
        folder_id = f"folder:{folder}"
        if folder_id not in nodes:
            nodes[folder_id] = {
                "id": folder_id,
                "label": folder,
                "type": "folder",
                "path": "",
                "folder": folder,
                "tags": [],
                "status": "",
                "metrics": {
                    "in_degree": 0,
                    "out_degree": 0,
                    "total_degree": 0,
                    "bridge_score": 0,
                    "orphan": False,
                },
            }

    edges = _add_folder_edges(nodes, edges)
    edges = _add_link_edges(nodes, edges, stem_to_id)
    edges = _add_tag_edges(nodes, edges)
    edges = _add_source_citation_edges(nodes, edges, stem_to_id)

    _compute_metrics(nodes, edges)

    return {"nodes": nodes, "edges": edges, "stem_to_id": stem_to_id}


def _add_folder_edges(
    nodes: dict[str, dict], edges: list[dict],
) -> list[dict]:
    for nid, node in nodes.items():
        if node["type"] in ("tag", "folder"):
            continue
        folder = node["folder"]
        folder_id = f"folder:{folder}"
        if folder_id in nodes:
            edges.append({
                "source": folder_id,
                "target": nid,
                "type": "folder_contains",
                "evidence": f"in {folder}/",
            })
    return edges


def _add_link_edges(
    nodes: dict[str, dict], edges: list[dict], stem_to_id: dict[str, str],
) -> list[dict]:
    for nid, node in nodes.items():
        wiki_links = node.get("_wiki_links", [])
        for link_target in wiki_links:
            target_id = stem_to_id.get(link_target)
            if target_id and target_id != nid:
                edges.append({
                    "source": nid,
                    "target": target_id,
                    "type": "wiki_link",
                    "evidence": f"[[{link_target}]]",
                })

        md_links = node.get("_md_links", [])
        for label, href in md_links:
            if href.startswith("http://") or href.startswith("https://"):
                ext_id = f"ext:{href[:120]}"
                if ext_id not in nodes:
                    nodes[ext_id] = {
                        "id": ext_id,
                        "label": label[:60] or href[:60],
                        "type": "external_link",
                        "path": href,
                        "folder": "",
                        "tags": [],
                        "status": "",
                        "metrics": {
                            "in_degree": 0,
                            "out_degree": 0,
                            "total_degree": 0,
                            "bridge_score": 0,
                            "orphan": False,
                        },
                    }
                edges.append({
                    "source": nid,
                    "target": ext_id,
                    "type": "markdown_link",
                    "evidence": f"[{label[:40]}]({href[:80]})",
                })
            else:
                clean = href.replace("%20", " ").replace(".md", "")
                clean = clean.split("/")[-1] if "/" in clean else clean
                target_id = stem_to_id.get(clean)
                if target_id and target_id != nid:
                    edges.append({
                        "source": nid,
                        "target": target_id,
                        "type": "markdown_link",
                        "evidence": f"[{label[:40]}]({href[:80]})",
                    })
    return edges


def _add_tag_edges(
    nodes: dict[str, dict], edges: list[dict],
) -> list[dict]:
    for nid, node in nodes.items():
        if node["type"] in ("tag", "folder", "external_link"):
            continue
        for tag in node.get("tags", []):
            tag_id = f"tag:{tag}"
            if tag_id in nodes:
                edges.append({
                    "source": nid,
                    "target": tag_id,
                    "type": "tagged_as",
                    "evidence": f"#{tag}",
                })
    return edges


def _add_source_citation_edges(
    nodes: dict[str, dict], edges: list[dict], stem_to_id: dict[str, str],
) -> list[dict]:
    for nid, node in nodes.items():
        if node["type"] in ("tag", "folder", "external_link"):
            continue
        content = node.get("_content", "")
        metadata = {}
        source_paths = []
        if "source_paths" in str(content).lower():
            for line in content.splitlines():
                stripped = line.strip()
                if stripped.startswith("- ") and "/" in stripped:
                    candidate = stripped[2:].strip().strip("`")
                    if candidate.endswith(".md"):
                        stem = Path(candidate).stem
                        target_id = stem_to_id.get(stem)
                        if target_id and target_id != nid:
                            edges.append({
                                "source": nid,
                                "target": target_id,
                                "type": "source_cites",
                                "evidence": f"cites {candidate}",
                            })
    return edges


def add_similarity_edges(
    nodes: dict[str, dict], edges: list[dict],
) -> list[dict]:
    note_nodes = [
        (nid, n) for nid, n in nodes.items()
        if n["type"] not in ("tag", "folder", "external_link")
    ]
    for i, (id_a, node_a) in enumerate(note_nodes):
        words_a = _title_words(node_a["label"])
        if len(words_a) < 2:
            continue
        for j in range(i + 1, len(note_nodes)):
            id_b, node_b = note_nodes[j]
            words_b = _title_words(node_b["label"])
            shared = words_a & words_b
            if len(shared) >= 2:
                edges.append({
                    "source": id_a,
                    "target": id_b,
                    "type": "similar_title",
                    "evidence": f"shared words: {', '.join(sorted(shared)[:5])}",
                })
    return edges


def _title_words(title: str) -> set[str]:
    words = re.findall(r"[A-Za-z]{4,}", title.lower())
    stop = {"with", "that", "this", "from", "have", "been", "were", "will",
            "should", "would", "could", "before", "after", "about", "their",
            "there", "these", "those", "which", "where", "when", "what"}
    return {w for w in words if w not in stop}


def _compute_metrics(nodes: dict[str, dict], edges: list[dict]) -> None:
    in_counts: Counter = Counter()
    out_counts: Counter = Counter()
    neighbor_folders: dict[str, set[str]] = defaultdict(set)
    neighbor_types: dict[str, set[str]] = defaultdict(set)

    for edge in edges:
        src = edge["source"]
        tgt = edge["target"]
        if edge["type"] == "folder_contains":
            continue
        out_counts[src] += 1
        in_counts[tgt] += 1

        if src in nodes and tgt in nodes:
            src_folder = nodes[src].get("folder", "")
            tgt_folder = nodes[tgt].get("folder", "")
            src_type = nodes[src].get("type", "")
            tgt_type = nodes[tgt].get("type", "")
            if src_folder:
                neighbor_folders[src].add(tgt_folder)
                neighbor_folders[tgt].add(src_folder)
            if src_type:
                neighbor_types[src].add(tgt_type)
                neighbor_types[tgt].add(src_type)

    for nid, node in nodes.items():
        ind = in_counts.get(nid, 0)
        outd = out_counts.get(nid, 0)
        total = ind + outd
        folders_connected = len(neighbor_folders.get(nid, set()))
        types_connected = len(neighbor_types.get(nid, set()))
        bridge = folders_connected + types_connected

        node["metrics"]["in_degree"] = ind
        node["metrics"]["out_degree"] = outd
        node["metrics"]["total_degree"] = total
        node["metrics"]["bridge_score"] = bridge
        node["metrics"]["orphan"] = (
            total == 0 and node["type"] not in ("tag", "folder", "external_link")
        )


def identify_orphans(nodes: dict[str, dict]) -> list[dict]:
    return sorted(
        [n for n in nodes.values() if n["metrics"]["orphan"]],
        key=lambda n: n["label"],
    )


def identify_bridge_nodes(nodes: dict[str, dict], top_n: int = 15) -> list[dict]:
    candidates = [
        n for n in nodes.values()
        if n["type"] not in ("tag", "folder", "external_link")
        and n["metrics"]["bridge_score"] > 0
    ]
    return sorted(candidates, key=lambda n: -n["metrics"]["bridge_score"])[:top_n]


def identify_central_nodes(nodes: dict[str, dict], top_n: int = 15) -> list[dict]:
    candidates = [
        n for n in nodes.values()
        if n["type"] not in ("tag", "folder", "external_link")
    ]
    return sorted(candidates, key=lambda n: -n["metrics"]["total_degree"])[:top_n]


def identify_weakly_connected(nodes: dict[str, dict]) -> list[dict]:
    return sorted(
        [
            n for n in nodes.values()
            if n["type"] not in ("tag", "folder", "external_link")
            and n["metrics"]["total_degree"] == 1
        ],
        key=lambda n: n["label"],
    )


def suggest_missing_links(
    nodes: dict[str, dict], edges: list[dict],
) -> list[dict[str, str]]:
    existing_links: set[tuple[str, str]] = set()
    for edge in edges:
        if edge["type"] in ("wiki_link", "markdown_link"):
            existing_links.add((edge["source"], edge["target"]))
            existing_links.add((edge["target"], edge["source"]))

    suggestions: list[dict[str, str]] = []
    note_nodes = [
        (nid, n) for nid, n in nodes.items()
        if n["type"] not in ("tag", "folder", "external_link")
    ]

    tag_to_notes: dict[str, list[str]] = defaultdict(list)
    for nid, node in note_nodes:
        for tag in node.get("tags", []):
            tag_to_notes[tag].append(nid)

    for tag, note_ids in tag_to_notes.items():
        if len(note_ids) < 2 or len(note_ids) > 20:
            continue
        for i, id_a in enumerate(note_ids):
            for j in range(i + 1, len(note_ids)):
                id_b = note_ids[j]
                if (id_a, id_b) not in existing_links:
                    suggestions.append({
                        "source": nodes[id_a]["path"] or id_a,
                        "target": nodes[id_b]["path"] or id_b,
                        "reason": f"share tag #{tag} but no direct link",
                        "confidence": "medium",
                    })

    for i, (id_a, node_a) in enumerate(note_nodes):
        words_a = _title_words(node_a["label"])
        if len(words_a) < 2:
            continue
        for j in range(i + 1, len(note_nodes)):
            id_b, node_b = note_nodes[j]
            if (id_a, id_b) in existing_links:
                continue
            words_b = _title_words(node_b["label"])
            shared = words_a & words_b
            if len(shared) >= 2:
                suggestions.append({
                    "source": node_a["path"] or id_a,
                    "target": node_b["path"] or id_b,
                    "reason": f"title keywords overlap: {', '.join(sorted(shared)[:4])}",
                    "confidence": "low",
                })

    for nid, node in note_nodes:
        if node["type"] != "promotion_draft":
            continue
        content = node.get("_content", "")
        for stem, target_id in nodes.items():
            pass
    _suggest_draft_references(nodes, note_nodes, existing_links, suggestions)

    seen = set()
    unique: list[dict[str, str]] = []
    for s in suggestions:
        key = (min(s["source"], s["target"]), max(s["source"], s["target"]))
        if key not in seen:
            seen.add(key)
            unique.append(s)
    return unique[:100]


def _suggest_draft_references(
    nodes: dict[str, dict],
    note_nodes: list[tuple[str, dict]],
    existing_links: set[tuple[str, str]],
    suggestions: list[dict[str, str]],
) -> None:
    promotion_types = {"promotion_draft", "promotion_report", "synthesis"}
    target_types = {"doctrine", "decision", "concept", "project"}
    promo_nodes = [(nid, n) for nid, n in note_nodes if n["type"] in promotion_types]
    target_nodes = [(nid, n) for nid, n in note_nodes if n["type"] in target_types]

    for p_id, p_node in promo_nodes:
        content_lower = p_node.get("_content", "").lower()
        for t_id, t_node in target_nodes:
            if (p_id, t_id) in existing_links:
                continue
            label_words = t_node["label"].lower().split()
            significant = [w for w in label_words if len(w) >= 4]
            if len(significant) >= 2:
                matches = sum(1 for w in significant if w in content_lower)
                if matches >= 2:
                    suggestions.append({
                        "source": p_node["path"] or p_id,
                        "target": t_node["path"] or t_id,
                        "reason": f"promotion artifact mentions '{t_node['label']}' by text",
                        "confidence": "medium",
                    })


def _count_themes(nodes: dict[str, dict]) -> list[tuple[str, int]]:
    tag_counts: Counter = Counter()
    for node in nodes.values():
        if node["type"] in ("tag", "folder", "external_link"):
            continue
        for tag in node.get("tags", []):
            if tag not in ("generated", "inbox", "daily"):
                tag_counts[tag] += 1
    return tag_counts.most_common(20)


def _summarize_relationships(nodes: dict[str, dict]) -> dict[str, int]:
    type_counts: Counter = Counter()
    for node in nodes.values():
        if node["type"] not in ("tag", "folder", "external_link"):
            type_counts[node["type"]] += 1
    return dict(type_counts)


def load_graphify_output() -> dict[str, Any] | None:
    gpath = VAULT / "20_Graphify" / "graph.json"
    if not gpath.exists():
        return None
    try:
        data = json.loads(gpath.read_text(encoding="utf-8", errors="ignore"))
        return data
    except (json.JSONDecodeError, OSError):
        return None


def load_semantic_status() -> dict[str, Any] | None:
    spath = VAULT / "40_Search" / "generated" / "status.json"
    if not spath.exists():
        return None
    try:
        data = json.loads(spath.read_text(encoding="utf-8", errors="ignore"))
        return data
    except (json.JSONDecodeError, OSError):
        return None


def generate_cortex_report(
    graph: dict[str, Any],
    scope: str,
    graphify_data: dict[str, Any] | None,
    semantic_data: dict[str, Any] | None,
) -> str:
    nodes = graph["nodes"]
    edges = graph["edges"]
    today = _local_today().isoformat()

    central = identify_central_nodes(nodes)
    bridges = identify_bridge_nodes(nodes)
    orphans = identify_orphans(nodes)
    weakly = identify_weakly_connected(nodes)
    themes = _count_themes(nodes)
    relationships = _summarize_relationships(nodes)

    note_count = sum(
        1 for n in nodes.values()
        if n["type"] not in ("tag", "folder", "external_link")
    )
    tag_count = sum(1 for n in nodes.values() if n["type"] == "tag")
    folder_count = sum(1 for n in nodes.values() if n["type"] == "folder")
    link_edges = sum(
        1 for e in edges
        if e["type"] in ("wiki_link", "markdown_link", "source_cites")
    )

    lines = [
        "---",
        "type: cortex-review",
        "status: draft",
        f"generated: {today}",
        f"scope: {scope}",
        "tags:",
        "  - cortex",
        "  - graph",
        "  - review",
        "  - generated",
        "---",
        "",
        f"# Cortex Review - {today}",
        "",
        "## Executive Summary",
        "",
        f"This cortex review analyzed **{note_count}** notes across **{folder_count}** folders,",
        f"producing a graph with **{len(nodes)}** total nodes (including {tag_count} tags)",
        f"and **{len(edges)}** edges ({link_edges} direct links).",
        "",
    ]

    if orphans:
        lines.append(f"**{len(orphans)}** orphan notes detected. ")
    if bridges:
        lines.append(f"Top bridge node: **{bridges[0]['label']}** (bridge score: {bridges[0]['metrics']['bridge_score']}). ")
    if central:
        lines.append(f"Most connected: **{central[0]['label']}** (degree: {central[0]['metrics']['total_degree']}).")
    lines.append("")

    lines.append("## Source Scope")
    lines.append("")
    lines.append(f"Scope: **{scope}**")
    lines.append("")
    if scope in ("core", "all"):
        lines.append("Core sources:")
        for d in CORE_SOURCE_DIRS:
            count = sum(1 for n in nodes.values() if n["folder"] == d)
            if count:
                lines.append(f"- `{d}/` ({count} notes)")
    if scope in ("promotions", "all"):
        lines.append("")
        lines.append("Promotion sources:")
        for d in PROMOTION_SOURCE_DIRS:
            top = d.split("/")[0]
            count = sum(1 for n in nodes.values() if n["path"].startswith(d))
            if count:
                lines.append(f"- `{d}/` ({count} notes)")
    lines.append("")

    lines.append("## Graph Summary")
    lines.append("")
    lines.append(f"| Metric | Count |")
    lines.append(f"|--------|-------|")
    lines.append(f"| Notes | {note_count} |")
    lines.append(f"| Tags | {tag_count} |")
    lines.append(f"| Folders | {folder_count} |")
    lines.append(f"| Total nodes | {len(nodes)} |")
    lines.append(f"| Total edges | {len(edges)} |")
    lines.append(f"| Direct links | {link_edges} |")
    lines.append(f"| Orphan notes | {len(orphans)} |")
    lines.append(f"| Weakly connected | {len(weakly)} |")
    lines.append("")

    lines.append("## Central Nodes")
    lines.append("")
    if central:
        lines.append("| Rank | Note | Type | Degree | Bridge |")
        lines.append("|------|------|------|--------|--------|")
        for i, n in enumerate(central[:15], 1):
            lines.append(
                f"| {i} | [[{n['label']}]] | {n['type']} "
                f"| {n['metrics']['total_degree']} | {n['metrics']['bridge_score']} |"
            )
    else:
        lines.append("No central nodes identified.")
    lines.append("")

    lines.append("## Bridge Nodes")
    lines.append("")
    if bridges:
        lines.append("Bridge nodes connect ideas across different folders and note types.")
        lines.append("")
        lines.append("| Rank | Note | Type | Bridge Score | Degree |")
        lines.append("|------|------|------|-------------|--------|")
        for i, n in enumerate(bridges[:15], 1):
            lines.append(
                f"| {i} | [[{n['label']}]] | {n['type']} "
                f"| {n['metrics']['bridge_score']} | {n['metrics']['total_degree']} |"
            )
    else:
        lines.append("No bridge nodes identified.")
    lines.append("")

    lines.append("## Orphan Notes")
    lines.append("")
    if orphans:
        lines.append(f"{len(orphans)} notes with no incoming or outgoing links:")
        lines.append("")
        for n in orphans[:30]:
            lines.append(f"- [[{n['label']}]] (`{n['path']}`) — {n['type']}")
    else:
        lines.append("No orphan notes detected.")
    lines.append("")

    lines.append("## Weakly Connected Notes")
    lines.append("")
    if weakly:
        lines.append(f"{len(weakly)} notes with only 1 connection:")
        lines.append("")
        for n in weakly[:20]:
            lines.append(f"- [[{n['label']}]] ({n['type']})")
    else:
        lines.append("No weakly connected notes.")
    lines.append("")

    lines.append("## Doctrine / Decision / Concept / Project Relationships")
    lines.append("")
    for rtype in ("doctrine", "decision", "concept", "project", "work_order", "case"):
        count = relationships.get(rtype, 0)
        if count:
            lines.append(f"- **{rtype}**: {count} notes")
    lines.append("")
    durable_edges = [
        e for e in edges
        if e["type"] in ("wiki_link", "markdown_link")
        and any(
            nodes.get(e["source"], {}).get("type") in ("doctrine", "decision", "concept", "project")
            or nodes.get(e["target"], {}).get("type") in ("doctrine", "decision", "concept", "project")
            for _ in [None]
        )
    ]
    if durable_edges:
        lines.append(f"{len(durable_edges)} edges involve durable-lane notes (doctrine/decision/concept/project).")
    lines.append("")

    lines.append("## Repeated Themes")
    lines.append("")
    if themes:
        lines.append("| Tag | Count |")
        lines.append("|-----|-------|")
        for tag, count in themes:
            lines.append(f"| #{tag} | {count} |")
    else:
        lines.append("No repeated themes detected.")
    lines.append("")

    lines.append("## Missing-Link Opportunities")
    lines.append("")
    suggestions = suggest_missing_links(nodes, edges)
    if suggestions:
        lines.append(f"{len(suggestions)} suggested links (see full report in `88_CortexMap/suggested_links/`):")
        lines.append("")
        for s in suggestions[:10]:
            lines.append(f"- `{s['source']}` → `{s['target']}` — {s['reason']} ({s['confidence']})")
    else:
        lines.append("No missing-link opportunities detected.")
    lines.append("")

    lines.append("## Graphify / Semantic Inputs")
    lines.append("")
    if graphify_data:
        g_nodes = len(graphify_data.get("nodes", []))
        g_edges = len(graphify_data.get("edges", graphify_data.get("links", [])))
        lines.append(f"Graphify output: **used** ({g_nodes} nodes, {g_edges} edges)")
    else:
        lines.append("Graphify output: **absent** (not required)")
    lines.append("")
    if semantic_data:
        s_mode = semantic_data.get("mode", "unknown")
        s_files = semantic_data.get("files_indexed", 0)
        lines.append(f"Semantic index: **available** (mode: {s_mode}, files: {s_files})")
    else:
        lines.append("Semantic index: **absent** (not required)")
    lines.append("")

    lines.append("## Suggested Next Reviews")
    lines.append("")
    if orphans:
        lines.append(f"- Review {len(orphans)} orphan notes for potential linking or archival")
    if weakly:
        lines.append(f"- Strengthen {len(weakly)} weakly connected notes with additional links")
    if suggestions:
        lines.append(f"- Evaluate {len(suggestions)} suggested missing links")
    lines.append("- Run `cortex-map` again after next weekly synthesis")
    lines.append("- Consider promoting high-bridge notes to doctrine or concept status")
    lines.append("")

    lines.append("## Source Paths")
    lines.append("")
    source_notes = sorted(
        [n for n in nodes.values() if n["type"] not in ("tag", "folder", "external_link")],
        key=lambda n: n["path"],
    )
    for n in source_notes:
        lines.append(f"- `{n['path']}`")
    lines.append("")

    lines.append("## Generator Notes")
    lines.append("")
    lines.append("This note was generated by WilliamOS. Review before acting. No source notes were modified.")
    lines.append("")

    return "\n".join(lines)


def write_graph_json(
    graph: dict[str, Any], scope: str,
) -> tuple[str, Path]:
    today = _local_today().isoformat()
    GRAPHS_DIR.mkdir(parents=True, exist_ok=True)

    out_nodes = []
    for node in graph["nodes"].values():
        out_nodes.append({
            "id": node["id"],
            "label": node["label"],
            "type": node["type"],
            "path": node["path"],
            "folder": node["folder"],
            "tags": node.get("tags", []),
            "status": node.get("status", ""),
            "metrics": node["metrics"],
        })

    out_edges = []
    for edge in graph["edges"]:
        out_edges.append({
            "source": edge["source"],
            "target": edge["target"],
            "type": edge["type"],
            "evidence": edge["evidence"],
        })

    data = {
        "generated": today,
        "scope": scope,
        "nodes": out_nodes,
        "edges": out_edges,
    }

    path = GRAPHS_DIR / f"cortex-graph-{today}.json"
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return today, path


def _sanitize_mermaid_id(text: str) -> str:
    s = re.sub(r"[^A-Za-z0-9_]", "_", text)
    s = re.sub(r"_+", "_", s).strip("_")
    return s[:40] or "node"


def write_mermaid_map(
    graph: dict[str, Any], scope: str, max_nodes: int = 40,
) -> Path:
    today = _local_today().isoformat()
    MAPS_DIR.mkdir(parents=True, exist_ok=True)
    nodes = graph["nodes"]
    edges = graph["edges"]

    ranked = sorted(
        [
            n for n in nodes.values()
            if n["type"] not in ("tag", "folder", "external_link")
        ],
        key=lambda n: -(n["metrics"]["total_degree"] + n["metrics"]["bridge_score"]),
    )
    top_nodes = ranked[:max_nodes]
    top_ids = {n["id"] for n in top_nodes}

    mermaid_lines = ["graph TD"]
    id_map: dict[str, str] = {}
    for node in top_nodes:
        mid = _sanitize_mermaid_id(node["label"])
        if mid in id_map.values():
            mid = _sanitize_mermaid_id(node["id"])
        id_map[node["id"]] = mid
        label = node["label"].replace('"', "'")[:50]
        mermaid_lines.append(f'  {mid}["{label}"]')

    for edge in edges:
        if edge["source"] in top_ids and edge["target"] in top_ids:
            src_mid = id_map.get(edge["source"])
            tgt_mid = id_map.get(edge["target"])
            if src_mid and tgt_mid and src_mid != tgt_mid:
                if edge["type"] in ("wiki_link", "markdown_link", "source_cites"):
                    mermaid_lines.append(f"  {src_mid} --> {tgt_mid}")

    seen_edges: set[str] = set()
    deduped: list[str] = []
    for line in mermaid_lines:
        if "-->" in line:
            if line not in seen_edges:
                seen_edges.add(line)
                deduped.append(line)
        else:
            deduped.append(line)
    mermaid_lines = deduped

    content = [
        "---",
        "type: cortex-map",
        "status: draft",
        f"generated: {today}",
        f"scope: {scope}",
        "tags:",
        "  - cortex",
        "  - graph",
        "  - map",
        "  - generated",
        "---",
        "",
        f"# Cortex Map - {today}",
        "",
        f"Top {min(max_nodes, len(top_nodes))} nodes by degree + bridge score.",
        "",
        "```mermaid",
    ]
    content.extend(mermaid_lines)
    content.append("```")
    content.append("")
    content.append(f"Full graph JSON: `WilliamOS/88_CortexMap/graphs/cortex-graph-{today}.json`")
    content.append("")

    path = MAPS_DIR / f"Cortex Map - {today}.md"
    path.write_text("\n".join(content), encoding="utf-8")
    return path


def write_suggested_links_report(
    graph: dict[str, Any],
) -> Path:
    today = _local_today().isoformat()
    SUGGESTED_LINKS_DIR.mkdir(parents=True, exist_ok=True)

    suggestions = suggest_missing_links(graph["nodes"], graph["edges"])

    lines = [
        "---",
        "type: suggested-links",
        "status: draft",
        f"generated: {today}",
        "tags:",
        "  - cortex",
        "  - links",
        "  - review",
        "  - generated",
        "---",
        "",
        f"# Suggested Links - {today}",
        "",
        f"Total suggestions: **{len(suggestions)}**",
        "",
        "Each suggestion is review-only. Do not apply automatically.",
        "",
    ]

    if suggestions:
        for i, s in enumerate(suggestions, 1):
            lines.append(f"### Suggestion {i}")
            lines.append("")
            lines.append(f"Source note: `{s['source']}`")
            lines.append(f"Suggested link: `{s['target']}`")
            lines.append(f"Reason: {s['reason']}")
            lines.append(f"Confidence: {s['confidence']}")
            lines.append("")
    else:
        lines.append("No missing-link opportunities detected.")
        lines.append("")

    lines.append("## Generator Notes")
    lines.append("")
    lines.append("This report was generated by WilliamOS. Review before acting. No source notes were modified.")
    lines.append("")

    path = SUGGESTED_LINKS_DIR / f"Suggested Links - {today}.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def cortex_map(scope: str = "all", dry_run: bool = False) -> dict[str, Any]:
    notes = scan_cortex_sources(scope)
    graph = build_graph(notes)
    add_similarity_edges(graph["nodes"], graph["edges"])
    _compute_metrics(graph["nodes"], graph["edges"])

    graphify_data = load_graphify_output()
    semantic_data = load_semantic_status()

    node_count = len(graph["nodes"])
    edge_count = len(graph["edges"])
    note_count = sum(
        1 for n in graph["nodes"].values()
        if n["type"] not in ("tag", "folder", "external_link")
    )
    orphan_count = len(identify_orphans(graph["nodes"]))
    bridge_count = len(identify_bridge_nodes(graph["nodes"]))
    central = identify_central_nodes(graph["nodes"])
    weakly_count = len(identify_weakly_connected(graph["nodes"]))
    suggestions = suggest_missing_links(graph["nodes"], graph["edges"])
    themes = _count_themes(graph["nodes"])
    relationships = _summarize_relationships(graph["nodes"])

    result: dict[str, Any] = {
        "scope": scope,
        "notes_scanned": len(notes),
        "note_count": note_count,
        "node_count": node_count,
        "edge_count": edge_count,
        "orphan_count": orphan_count,
        "bridge_count": bridge_count,
        "weakly_connected_count": weakly_count,
        "central_nodes": [n["label"] for n in central[:10]],
        "suggestion_count": len(suggestions),
        "theme_count": len(themes),
        "top_themes": themes[:10],
        "relationships": relationships,
        "graphify_used": graphify_data is not None,
        "semantic_available": semantic_data is not None,
    }

    if dry_run:
        result["dry_run"] = True
        return result

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_text = generate_cortex_report(graph, scope, graphify_data, semantic_data)
    today = _local_today().isoformat()
    report_path = REPORTS_DIR / f"Cortex Review - {today}.md"
    report_path.write_text(report_text, encoding="utf-8")
    result["report_path"] = str(report_path)

    _, json_path = write_graph_json(graph, scope)
    result["graph_json_path"] = str(json_path)

    mermaid_path = write_mermaid_map(graph, scope)
    result["mermaid_path"] = str(mermaid_path)

    links_path = write_suggested_links_report(graph)
    result["suggested_links_path"] = str(links_path)

    return result


def get_cortex_status() -> dict[str, Any]:
    cortex_exists = CORTEX_DIR.exists()
    docs = [
        "88_CortexMap/README.md",
        "88_CortexMap/CORTEX_MAP_POLICY.md",
        "88_CortexMap/GRAPH_MODEL.md",
        "88_CortexMap/REVIEW_WORKFLOW.md",
    ]
    docs_exist = all((VAULT / d).exists() for d in docs)
    reports_exist = REPORTS_DIR.exists()
    graphs_exist = GRAPHS_DIR.exists()
    maps_exist = MAPS_DIR.exists()

    core_count = len(scan_cortex_sources("core"))
    promo_count = len(scan_cortex_sources("promotions"))
    all_count = len(scan_cortex_sources("all"))

    last_report = None
    if reports_exist:
        reports = sorted(REPORTS_DIR.glob("*.md"), reverse=True)
        if reports:
            last_report = str(reports[0].name)

    last_graph = None
    node_count = 0
    edge_count = 0
    if graphs_exist:
        graphs = sorted(GRAPHS_DIR.glob("*.json"), reverse=True)
        if graphs:
            last_graph = str(graphs[0].name)
            try:
                data = json.loads(graphs[0].read_text(encoding="utf-8"))
                node_count = len(data.get("nodes", []))
                edge_count = len(data.get("edges", []))
            except (json.JSONDecodeError, OSError):
                pass

    graphify_exists = (VAULT / "20_Graphify" / "graph.json").exists()
    semantic_exists = (VAULT / "40_Search" / "generated" / "status.json").exists()

    return {
        "cortex_dir_exists": cortex_exists,
        "docs_exist": docs_exist,
        "reports_dir_exists": reports_exist,
        "graphs_dir_exists": graphs_exist,
        "maps_dir_exists": maps_exist,
        "core_source_notes": core_count,
        "promotion_source_notes": promo_count,
        "all_source_notes": all_count,
        "last_report": last_report,
        "last_graph": last_graph,
        "last_graph_nodes": node_count,
        "last_graph_edges": edge_count,
        "graphify_exists": graphify_exists,
        "semantic_exists": semantic_exists,
    }
