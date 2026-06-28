---
type: reference
status: active
area: workspace
created: 2026-06-15
tags:
  - workspace
  - linking
  - reference
---

# Linking Guide

How to use wikilinks in the WilliamOS vault for maximum discoverability.

## Link Format

Use Obsidian wikilinks: `[[Note Title]]` or `[[Note Title|Display Text]]`.

Do NOT use Markdown links `[text](path)` for internal vault notes — wikilinks enable graph view, backlinks, and auto-rename.

## When to Link

1. **Mention a concept that has its own note** — link it: `[[Highest and Best Use]]`
2. **Reference a decision** — link it: `[[Decision - Adopt CAMA Override Policy]]`
3. **Name a person** — link it: `[[Person - Jane Smith]]`
4. **Cite a case** — link it: `[[Case - Comparable Sales Dispute 2026]]`
5. **Reference a project** — link it: `[[Project - TerraFusion Phase 2]]`

## When NOT to Link

- Don't link common words that happen to match note titles
- Don't link the same note multiple times in one paragraph
- Don't create links to notes that don't exist unless you intend to create them
- Don't link inside YAML frontmatter

## Linking Patterns

### Daily Notes

Link decisions made, people met, projects discussed:

```markdown
## Decisions
- Discussed [[Decision - Budget Timeline]] with [[Person - County Manager]]

## Projects
- [[Project - TerraFusion Phase 2]] sprint review completed
```

### Decision Records

Link related doctrine, prior decisions, and affected projects:

```markdown
## Context
This extends [[Decision - Adopt CAMA Override Policy]] and aligns with
[[Doctrine - Transparency by Default]].

## Impact
Affects [[Project - TerraFusion Phase 2]] and [[Project - Public Portal Redesign]].
```

### Doctrine Notes

Link the decisions and cases that evidence the principle:

```markdown
## Evidence
- [[Decision - Open Data Initiative]] — applied this principle
- [[Case - Assessment Appeal 2025-142]] — tested this under pressure
```

### MOC (Map of Content) Notes

MOCs are link-heavy by design — they're navigation hubs:

```markdown
## Key Decisions
- [[Decision - Adopt CAMA Override Policy]]
- [[Decision - Budget Timeline]]

## Active Projects
- [[Project - TerraFusion Phase 2]]
```

## Graph Health

- Aim for 2-5 wikilinks per content note
- Notes with zero links are "orphans" — run `python scripts/william.py orphans` to find them
- Notes linked from only one place are fragile — consider adding a second link from a MOC or related note
- MOCs should link to many notes but don't need to link to everything
