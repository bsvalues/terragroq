---
type: feature-guide
feature: research-drop-zone
phase: 5C
generated: 2026-06-24
tags:
  - devkit
  - research
  - intake
---

# Research Drop Zone Guide — Phase 5C

> **Authority boundary:**
> Research Drop Zone is an intake pipeline, not an autonomous research agent.
> Generated notes are unreviewed. Generated notes are not canon.
> Promotion to canon requires a separate reviewed action.

---

## What the Research Drop Zone Is

The Research Drop Zone is a controlled file intake pipeline built into the WilliamOS
Control Center Operator Home. It accepts files from the operator, processes them
into the vault system, and makes them discoverable via semantic search and RAG —
but it never treats them as authoritative canon.

Every file that enters the Drop Zone goes through:
1. **Hash-based deduplication** — duplicate uploads are detected and rejected cleanly.
2. **Original preservation** — the source file is copied verbatim, unchanged.
3. **Metadata recording** — a JSON sidecar captures all intake facts.
4. **Note extraction** — a markdown note is generated with `authority: unreviewed`.
5. **Index registration** — the note is added to the semantic search index.
6. **Evidence recording** — the intake event appears in the Evidence rail and History.

---

## Supported File Types

| Type | Extension(s) | Notes |
|------|-------------|-------|
| PDF | .pdf | Text extracted; images not analyzed |
| Plain text | .txt | Full content extracted |
| Markdown | .md | Full content extracted |
| CSV | .csv | Content extracted as text |
| HTML | .html, .htm | Text extracted; HTML tags stripped |
| Images | .png, .jpg, .jpeg, .gif, .webp | File stored; minimal text note created |

**Unsupported file behavior:**
- Unsupported extensions are rejected with a clear operator message.
- No file is written when an unsupported file is dropped.
- The operator sees an error card in the Drop Zone panel; no Evidence rail entry is created.

---

## What Gets Created for Each Intake

For a file named `example-research.pdf`:

**Original (verbatim copy):**
```
WilliamOS/110_ControlCenter/research_intake/originals/<hash>-example-research.pdf
```

**Metadata JSON:**
```
WilliamOS/110_ControlCenter/research_intake/metadata/<hash>.json
```

Fields in the metadata JSON:
```json
{
  "source_filename": "example-research.pdf",
  "sha256": "<64-char hex hash>",
  "size_bytes": 12345,
  "file_type": ".pdf",
  "content_type": "application/pdf",
  "intake_timestamp": "2026-06-24T15:00:00",
  "classification": "research",
  "original_path": "research_intake/originals/<hash>-example-research.pdf",
  "note_path": "WilliamOS/07_Learning/Research Intake/<date>-<slug>.md",
  "search_indexed": true,
  "rag_indexed": true
}
```

**Extracted markdown note:**
```
WilliamOS/07_Learning/Research Intake/<date>-<slug>.md
```

Every generated note contains:
```yaml
---
authority: unreviewed
canon: false
source: research_intake
intake_date: <date>
source_file: <original filename>
---
```

And an intake-only notice at the top:
```
> **Intake note — not canon.** This note was generated automatically from a dropped
> file. It has not been reviewed or promoted. Do not treat this content as authoritative.
```

---

## Hash-Based Duplicate Detection

If the same file (identical bytes) is dropped a second time:
- The SHA-256 hash matches an existing entry.
- No second original is created.
- No second note is created.
- The existing intake item is returned.
- The Evidence rail shows a "duplicate detected" entry.

If a file with the same name but different content is dropped:
- The SHA-256 hash does not match.
- A new intake item is created normally.
- Both originals coexist under their respective hashes.

---

## Authority Boundary

The Research Drop Zone enforces these boundaries at intake time:

1. **No write access to canon folders.** Extracted notes land only in
   `WilliamOS/07_Learning/Research Intake/`, never in `02_Decisions/`,
   `03_Doctrine/`, `10_Ideas/`, or any high-trust path.

2. **No automatic promotion.** An extracted note never becomes canon automatically.
   Promotion requires the standard doctrine/decision/concept promotion workflow
   with Bill's explicit approval.

3. **No external fetch.** The Drop Zone does not fetch URLs, does not crawl the web,
   and does not call any external service. It processes only the file you give it.

4. **No command execution.** Processing a dropped file does not run any shell command,
   make any git commit, or invoke any governance tool.

---

## Search / RAG Indexing

After intake, extracted notes are:
- Added to the semantic search index (nomic-embed-text embeddings)
- Available to the copilot RAG pipeline on next query

To verify:
```bash
python scripts/william.py semantic-search "your research topic"
```

The copilot will cite the intake note in answers, clearly labeled with its
intake path and `authority: unreviewed` status.

---

## Evidence Rail and History Visibility

Each intake event creates:
- An Evidence rail entry showing: filename, hash (truncated), intake path, note path
- A History entry in the current session

These are audit records. They cannot be edited or deleted through the UI.

---

## Intake Smoke Test

To verify the Research Drop Zone is working correctly:

1. Drop a small text file into the Drop Zone (e.g., a `.txt` file with a few sentences).
2. Confirm: original copied to `research_intake/originals/`
3. Confirm: note created in `WilliamOS/07_Learning/Research Intake/`
4. Confirm: metadata JSON created in `research_intake/metadata/`
5. Confirm: Evidence rail shows a new entry
6. Confirm: History shows the intake event
7. Run semantic search:
   ```bash
   python scripts/william.py semantic-search "<text from your file>"
   ```
8. Confirm: search returns the generated note
9. In the chat, ask about the content. Confirm: the copilot cites the intake note.
10. Drop the same file again. Confirm: no second original or note is created.

---

## Intake Storage Paths

| Path | Contents |
|------|----------|
| `WilliamOS/110_ControlCenter/research_intake/originals/` | Verbatim copies of all dropped files |
| `WilliamOS/110_ControlCenter/research_intake/metadata/` | JSON sidecar for each intake |
| `WilliamOS/07_Learning/Research Intake/` | Extracted markdown notes (unreviewed) |

The `research_intake/` directory is git-tracked. Large binary originals may be
excluded by `.gitattributes` if LFS is configured in a future hardening pass.
