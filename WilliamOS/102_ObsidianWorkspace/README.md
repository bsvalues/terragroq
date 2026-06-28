---
type: governance
status: active
area: workspace
created: 2026-06-15
tags:
  - workspace
  - governance
---

# 102_ObsidianWorkspace

Workspace quality governance for the WilliamOS Obsidian vault.

## Purpose

This layer ensures the vault is pleasant, discoverable, and obvious to use every day. It covers folder READMEs, tag conventions, linking patterns, dashboard coverage, and quality metrics — without modifying any source notes.

## What This Layer Does

- Defines tag conventions and a maintained TAG_INDEX
- Provides a LINKING_GUIDE for consistent wikilink usage
- Establishes README standards for every content folder
- Scans workspace quality (frontmatter, links, tags, dashboards)
- Generates quality reports

## What This Layer Does NOT Do

- Modify source notes
- Create or install Obsidian plugins
- Configure Obsidian settings
- Enable sync or cloud features
- Touch high-trust folders (02_Decisions, 03_Doctrine, 10_Ideas, 11_Projects)

## Files

- `README.md` — this file
- `WORKSPACE_POLICY.md` — rules for workspace quality automation
- `TAG_INDEX.md` — canonical tag reference
- `LINKING_GUIDE.md` — wikilink conventions and patterns
- `FOLDER_README_GUIDE.md` — standards for folder README notes

## Commands

```bash
python scripts/william.py obsidian-status    # workspace quality summary
python scripts/william.py obsidian-quality   # generate quality report
python scripts/william.py obsidian-quality --dry-run  # preview without writing
```

## Engine

- `scripts/williamos_workspace.py` — workspace quality scanner and report generator
