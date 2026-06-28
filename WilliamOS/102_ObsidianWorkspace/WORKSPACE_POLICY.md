---
type: policy
status: active
area: workspace
created: 2026-06-15
tags:
  - workspace
  - policy
---

# Workspace Policy

## Scope

This policy governs automated workspace quality scanning and reporting. It does NOT govern note content or folder structure changes.

## Rules

1. **Read-only scanning.** The workspace engine reads notes to compute quality metrics. It never modifies source notes.
2. **Reports go to `102_ObsidianWorkspace/reports/`.** Generated quality reports are the only files the engine writes.
3. **High-trust folders are exempt.** Notes in 02_Decisions, 03_Doctrine, 10_Ideas, and 11_Projects are scanned for metrics but never flagged as needing changes.
4. **Governance folders are excluded from content metrics.** Folders numbered 20+ are infrastructure — they're not content notes and don't count toward link density or frontmatter coverage.
5. **Templates are excluded.** The 13_Templates folder has its own conventions.
6. **Tag conventions are advisory.** The TAG_INDEX documents recommended tags but doesn't enforce them.
7. **Linking conventions are advisory.** The LINKING_GUIDE describes patterns but doesn't require them.
8. **No Obsidian plugins required.** All quality commands work without Dataview or any other plugin.
9. **No internet required.** All scanning is local.
10. **No sync, no cloud, no remote.** This layer is entirely local.

## Quality Dimensions

The workspace quality report covers:

- **Folder READMEs** — does every content folder have a README?
- **Frontmatter completeness** — do content notes have YAML frontmatter with type/status?
- **Link density** — how connected are notes via wikilinks?
- **Tag usage** — what tags are in use and how evenly distributed?
- **Dashboard coverage** — how many dashboards exist and what do they link to?
- **Template coverage** — are templates complete with frontmatter and sections?
